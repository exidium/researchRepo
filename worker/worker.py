"""
Transcription worker for researchRepo.

Loop: claim the oldest QUEUED job with FOR UPDATE SKIP LOCKED, transcribe the source's recording with
faster-whisper, coalesce Whisper's short segments into utterances (same rule as the VTT/SRT importer,
decision D18), and replace the source's segments in one transaction. Refuses to overwrite a source that
has highlights (decision D20). Progress is written as audio position / duration.

Speakers: sherpa-onnx diarization (pyannote segmentation + TitaNet embeddings, ONNX, no PyTorch, no account).
Whisper runs with word timestamps; each word takes the speaker whose turn covers it and lines split where the
speaker changes. If diarization fails, the transcript is still written without speaker names.

Env: DATABASE_URL, UPLOAD_DIR, WHISPER_MODEL (default "medium"), WHISPER_THREADS (default: all cores),
WHISPER_BEAM (default 5), POLL_SECONDS (default 5), DIARIZE (default "1"), DIARIZATION_MODELS (folder with
segmentation.onnx and embedding.onnx), DIARIZE_THRESHOLD (clustering distance, default 0.5).
"""
import os
import re
import secrets
import signal
import sys
import time
import traceback

import psycopg
from faster_whisper import WhisperModel

DB = os.environ["DATABASE_URL"].split("?")[0]
UPLOAD_DIR = os.path.realpath(os.environ.get("UPLOAD_DIR", "./uploads"))
MODEL_NAME = os.environ.get("WHISPER_MODEL", "medium")
THREADS = int(os.environ.get("WHISPER_THREADS", str(os.cpu_count() or 4)))
BEAM = int(os.environ.get("WHISPER_BEAM", "5"))
POLL = float(os.environ.get("POLL_SECONDS", "5"))
DIARIZE = os.environ.get("DIARIZE", "1") == "1"
DIAR_DIR = os.environ.get("DIARIZATION_MODELS", "/opt/diarization")
DIAR_THRESHOLD = float(os.environ.get("DIARIZE_THRESHOLD", "0.5"))

running = True


def stop(*_):
    global running
    running = False


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def new_id():
    # Prisma ids are opaque strings; a 25-char lowercase id keeps the same shape as cuid().
    return "c" + secrets.token_hex(12)


def resolve(rel):
    path = os.path.realpath(os.path.join(UPLOAD_DIR, rel))
    if not (path == UPLOAD_DIR or path.startswith(UPLOAD_DIR + os.sep)):
        raise RuntimeError("recording path escapes UPLOAD_DIR")
    return path


def coalesce(segs, max_gap_ms=2000, target=200, hard_max=700):
    out = []
    for s in segs:
        cur = out[-1] if out else None
        if cur and cur["speaker"] == s["speaker"] and s["start"] - cur["end"] <= max_gap_ms \
                and len(cur["text"]) + len(s["text"]) <= hard_max \
                and not (re.search(r"[.!?…][\"'”’)\]]?$", cur["text"]) and len(cur["text"]) >= target):
            cur["text"] = (cur["text"] + " " + s["text"]).strip()
            cur["end"] = s["end"]
        else:
            out.append(dict(s))
    return out


_diarizer = None
_extractor = None
REFINE_MIN_S = 1.0      # lines shorter than this keep the first-pass speaker
REFINE_MARGIN = 0.05    # cosine-similarity margin needed to move a line to another speaker
MINOR_SPEAKER_S = 8.0   # a "speaker" with less speech than this AND under MINOR_SPEAKER_SHARE is a diarization artefact
MINOR_SPEAKER_SHARE = 0.03


def _models():
    global _diarizer, _extractor
    import sherpa_onnx as so
    if _diarizer is None:
        emb_cfg = so.SpeakerEmbeddingExtractorConfig(model=os.path.join(DIAR_DIR, "embedding.onnx"), num_threads=THREADS)
        cfg = so.OfflineSpeakerDiarizationConfig(
            segmentation=so.OfflineSpeakerSegmentationModelConfig(
                pyannote=so.OfflineSpeakerSegmentationPyannoteModelConfig(model=os.path.join(DIAR_DIR, "segmentation.onnx")), num_threads=THREADS),
            embedding=emb_cfg,
            clustering=so.FastClusteringConfig(num_clusters=-1, threshold=DIAR_THRESHOLD),
            min_duration_on=0.3, min_duration_off=0.5)
        if not cfg.validate():
            raise RuntimeError(f"diarization models missing or invalid in {DIAR_DIR}")
        _diarizer = so.OfflineSpeakerDiarization(cfg)
        _extractor = so.SpeakerEmbeddingExtractor(emb_cfg)
    return _diarizer, _extractor


def diarize(path):
    """
    Pass 1: sherpa-onnx diarization → turns [(start_ms, end_ms, "Speaker N")], numbered by first appearance.
    Returns (turns, refine) where refine(cues) is pass 2: each cue of at least REFINE_MIN_S gets a voiceprint
    and moves to the nearest speaker's voiceprint if that is clearly closer. Pass 2 fixes turns the segmenter
    merged across short pauses. Returns ([], identity) when diarization is off or fails.
    """
    identity = lambda cues: cues
    if not DIARIZE:
        return [], identity
    try:
        import numpy as np
        from faster_whisper.audio import decode_audio
        sd, ext = _models()
        sr = sd.sample_rate
        audio = decode_audio(path, sampling_rate=sr)

        def voiceprint(a_ms, b_ms):
            st = ext.create_stream()
            st.accept_waveform(sr, audio[int(a_ms * sr / 1000):int(b_ms * sr / 1000)])
            st.input_finished()
            v = np.array(ext.compute(st))
            return v / (np.linalg.norm(v) + 1e-9)

        names, turns = {}, []
        for r in sd.process(audio).sort_by_start_time():
            names.setdefault(r.speaker, f"Speaker {len(names) + 1}")
            turns.append((int(r.start * 1000), int(r.end * 1000), names[r.speaker]))

        centroids = {}
        for a, b, label in turns:
            if b - a >= REFINE_MIN_S * 1000:
                centroids.setdefault(label, []).append(voiceprint(a, b) * (b - a))
        centroids = {k: (lambda m: m / (np.linalg.norm(m) + 1e-9))(np.sum(v, axis=0)) for k, v in centroids.items()}

        speech = {}
        for a, b, label in turns:
            speech[label] = speech.get(label, 0) + (b - a) / 1000
        total = sum(speech.values()) or 1
        minor = {k for k, sec in speech.items() if sec < MINOR_SPEAKER_S and sec < MINOR_SPEAKER_SHARE * total}
        major = {k: v for k, v in centroids.items() if k not in minor}

        def refine(cues):
            if not major:
                return cues
            moved = folded = 0
            for i, c in enumerate(cues):
                long_enough = c["end"] - c["start"] >= REFINE_MIN_S * 1000
                if c["speaker"] in minor:
                    # Artefact speaker: nearest real voice, or the neighbouring line's speaker if too short to measure.
                    if c["end"] - c["start"] >= 500:
                        e = voiceprint(c["start"], c["end"])
                        c["speaker"] = max(major, key=lambda k: float(e @ major[k]))
                    else:
                        near = [x["speaker"] for x in cues[i - 1:i] + cues[i + 1:i + 2] if x["speaker"] in major]
                        c["speaker"] = near[0] if near else next(iter(major))
                    folded += 1
                elif long_enough and len(major) >= 2 and c["speaker"] in major:
                    e = voiceprint(c["start"], c["end"])
                    sims = {k: float(e @ v) for k, v in major.items()}
                    best = max(sims, key=sims.get)
                    if best != c["speaker"] and sims[best] - sims[c["speaker"]] >= REFINE_MARGIN:
                        c["speaker"] = best
                        moved += 1
            # Renumber by first appearance so names stay Speaker 1, 2, 3 after folding.
            order = {}
            for c in cues:
                if c["speaker"] and c["speaker"] not in order:
                    order[c["speaker"]] = f"Speaker {len(order) + 1}"
            for c in cues:
                if c["speaker"]:
                    c["speaker"] = order[c["speaker"]]
            if moved or folded:
                log(f"speaker pass 2: moved {moved} line(s), folded {folded} line(s) from {len(minor)} artefact speaker(s)")
            return cues

        return turns, refine
    except Exception as e:  # speakers are a bonus, never a reason to lose the transcript
        log("diarization failed, continuing without speakers:", e)
        return [], identity


def speaker_at(start, end, turns):
    """Speaker with the most overlap; with no overlap (a word in a pause), the nearest turn."""
    best, overlap = None, 0
    for ts, te, label in turns:
        o = min(end, te) - max(start, ts)
        if o > overlap:
            best, overlap = label, o
    if best is None and turns:
        mid = (start + end) / 2
        best = min(turns, key=lambda t: min(abs(mid - t[0]), abs(mid - t[1])))[2]
    return best


SENTENCE_END = re.compile(r"[.!?…][\"'”’)\]]?$")


def sentences(segments, max_gap_ms=1000):
    """Whisper segments (with words) → sentences: break after sentence punctuation or a pause over max_gap_ms."""
    out, cur = [], None
    for seg in segments:
        words = seg["words"] or [{"start": seg["start"], "end": seg["end"], "word": " " + seg["text"]}]
        for w in words:
            if cur and w["start"] - cur["end"] > max_gap_ms:
                out.append(cur)
                cur = None
            if cur is None:
                cur = {"start": w["start"], "end": w["end"], "text": "", "words": [], "speaker": None}
            cur["text"] += w["word"]
            cur["end"] = w["end"]
            cur["words"].append(w)
            if SENTENCE_END.search(w["word"].strip()):
                out.append(cur)
                cur = None
    if cur:
        out.append(cur)
    for c in out:
        c["text"] = re.sub(r"\s+", " ", c["text"]).strip()
    return [c for c in out if c["text"]]


def assign_speakers(sents, turns):
    """Pass-1 speaker for each sentence: the speaker with the most overlap across its words (one speaker per sentence)."""
    for c in sents:
        if not turns:
            c["speaker"] = None
            continue
        weight = {}
        for w in c["words"]:
            spk = speaker_at(w["start"], w["end"], turns)
            weight[spk] = weight.get(spk, 0) + max(w["end"] - w["start"], 1)
        c["speaker"] = max(weight, key=weight.get)
    return sents


def split_by_speaker(segments, turns):
    """Sentences, each with one speaker (kept as the name the rest of the pipeline and the tests use)."""
    return assign_speakers(sentences(segments), turns)


def claim(conn):
    with conn.transaction():
        row = conn.execute(
            """SELECT j.id, j."sourceId", j.model, j.language, s."recordingPath"
               FROM "TranscriptionJob" j JOIN "Source" s ON s.id = j."sourceId"
               WHERE j.status = 'QUEUED' ORDER BY j."createdAt" LIMIT 1 FOR UPDATE OF j SKIP LOCKED"""
        ).fetchone()
        if not row:
            return None
        conn.execute("""UPDATE "TranscriptionJob" SET status = 'RUNNING', "startedAt" = now(), progress = 0, error = NULL WHERE id = %s""", (row[0],))
        conn.execute("""UPDATE "Source" SET status = 'PROCESSING', "errorMessage" = NULL WHERE id = %s""", (row[1],))
        return row


def fail(conn, job_id, source_id, message):
    with conn.transaction():
        conn.execute("""UPDATE "TranscriptionJob" SET status = 'FAILED', error = %s, "finishedAt" = now() WHERE id = %s""", (message[:2000], job_id))
        conn.execute(
            """UPDATE "Source" SET status = CASE WHEN EXISTS (SELECT 1 FROM "Segment" WHERE "sourceId" = %s) THEN 'READY'::"SourceStatus" ELSE 'FAILED'::"SourceStatus" END,
               "errorMessage" = %s WHERE id = %s""", (source_id, "Transcription failed: " + message[:500], source_id))


models = {}


def model_for(name):
    if name not in models:
        log(f"loading model {name} (threads={THREADS})")
        models[name] = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=THREADS, download_root=os.environ.get("HF_HOME"))
    return models[name]


def process(conn, job):
    job_id, source_id, model_name, language, rel = job
    if not rel:
        raise RuntimeError("source has no recording")
    path = resolve(rel)
    if not os.path.exists(path):
        raise RuntimeError("recording file is missing on disk")
    t0 = time.time()
    model = model_for(model_name or MODEL_NAME)
    segments, info = model.transcribe(path, language=language or None, beam_size=BEAM, vad_filter=True,
                                      condition_on_previous_text=False, word_timestamps=True)
    duration = max(info.duration, 0.001)
    log(f"job {job_id}: language={info.language} p={info.language_probability:.2f} audio={duration:.0f}s")
    raw, last_report = [], 0.0
    for seg in segments:
        text = seg.text.strip()
        # Whisper's own hallucination rule: likely silence decoded as text.
        if text and not (seg.no_speech_prob > 0.6 and seg.avg_logprob < -1.0):
            raw.append({"start": int(seg.start * 1000), "end": int(seg.end * 1000), "text": text,
                        "words": [{"start": int(w.start * 1000), "end": int(w.end * 1000), "word": w.word} for w in (seg.words or [])]})
        if time.time() - last_report > 5:
            last_report = time.time()
            with conn.transaction():
                conn.execute("""UPDATE "TranscriptionJob" SET progress = %s WHERE id = %s""", (min(seg.end / duration, 0.99), job_id))
    with conn.transaction():
        conn.execute("""UPDATE "TranscriptionJob" SET progress = 0.99 WHERE id = %s""", (job_id,))
    t_d = time.time()
    turns, refine = diarize(path)
    raw = refine(split_by_speaker(raw, turns))
    if turns:
        log(f"job {job_id}: {len({c['speaker'] for c in raw if c['speaker']})} speakers in {time.time() - t_d:.0f}s")
    # With speaker labels, merge same-speaker cues into utterances (D18). Without them every cue has the same
    # (empty) speaker, so only join fragments that do not end a sentence: questions and answers stay separate
    # lines that can each be given a speaker in the editor.
    merged = coalesce(raw) if turns else coalesce(raw, target=1)
    if not merged:
        raise RuntimeError("no speech found in the recording")

    with conn.transaction():
        if conn.execute("""SELECT 1 FROM "Highlight" WHERE "sourceId" = %s LIMIT 1""", (source_id,)).fetchone():
            raise RuntimeError("source already has highlights; transcript not replaced")
        conn.execute("""DELETE FROM "Segment" WHERE "sourceId" = %s""", (source_id,))
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO "Segment" (id, "sourceId", "order", speaker, "startMs", "endMs", text, version) VALUES (%s, %s, %s, %s, %s, %s, %s, 1)""",
                [(new_id(), source_id, i, s["speaker"], s["start"], s["end"], s["text"]) for i, s in enumerate(merged)],
            )
        conn.execute(
            """UPDATE "Source" SET kind = 'TRANSCRIPT', status = 'READY', "errorMessage" = NULL, language = %s,
               "transcriptName" = %s, "durationMs" = COALESCE("durationMs", %s) WHERE id = %s""",
            (info.language, f"Automatic transcript (whisper {model_name or MODEL_NAME})", int(duration * 1000), source_id),
        )
        conn.execute(
            """UPDATE "TranscriptionJob" SET status = 'DONE', progress = 1, "finishedAt" = now(), "segmentCount" = %s, "audioMs" = %s, language = %s WHERE id = %s""",
            (len(merged), int(duration * 1000), info.language, job_id),
        )
    log(f"job {job_id}: {len(merged)} segments in {time.time() - t0:.0f}s (realtime x{duration / max(time.time() - t0, 1):.1f})")


def main():
    log(f"worker up: model={MODEL_NAME} threads={THREADS} diarize={DIARIZE} uploads={UPLOAD_DIR}")
    while running:
        try:
            with psycopg.connect(DB, autocommit=False) as conn:
                # Jobs left RUNNING by a crash or restart go back to the queue.
                with conn.transaction():
                    conn.execute("""UPDATE "TranscriptionJob" SET status = 'QUEUED' WHERE status = 'RUNNING'""")
                while running:
                    job = claim(conn)
                    if not job:
                        time.sleep(POLL)
                        continue
                    try:
                        process(conn, job)
                    except Exception as e:
                        log(f"job {job[0]} failed: {e}")
                        traceback.print_exc()
                        conn.rollback()
                        fail(conn, job[0], job[1], str(e))
        except psycopg.OperationalError as e:
            log("database unavailable, retrying:", e)
            time.sleep(10)
    log("worker stopped")


if __name__ == "__main__":
    sys.exit(main())
