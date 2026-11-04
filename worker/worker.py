"""
Transcription worker for researchRepo.

Loop: claim the oldest QUEUED job with FOR UPDATE SKIP LOCKED, transcribe the source's recording with
faster-whisper, coalesce Whisper's short segments into utterances (same rule as the VTT/SRT importer,
decision D18), and replace the source's segments in one transaction. Refuses to overwrite a source that
has highlights (decision D20). Progress is written as audio position / duration.

Env: DATABASE_URL, UPLOAD_DIR, WHISPER_MODEL (default "medium"), WHISPER_THREADS (default: all cores),
WHISPER_BEAM (default 5), POLL_SECONDS (default 5), HF_TOKEN + DIARIZE=1 for optional pyannote diarization.
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
DIARIZE = os.environ.get("DIARIZE") == "1" and bool(os.environ.get("HF_TOKEN"))

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


def diarize(path):
    """Returns [(start_ms, end_ms, label)] or [] when diarization is off or fails."""
    if not DIARIZE:
        return []
    try:
        from pyannote.audio import Pipeline  # type: ignore
        pipe = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=os.environ["HF_TOKEN"])
        turns = pipe(path)
        names = {}
        result = []
        for turn, _, spk in turns.itertracks(yield_label=True):
            names.setdefault(spk, f"Speaker {len(names) + 1}")
            result.append((int(turn.start * 1000), int(turn.end * 1000), names[spk]))
        return result
    except Exception as e:  # diarization is a bonus, never a reason to fail the transcript
        log("diarization failed:", e)
        return []


def speaker_for(start, end, turns):
    best, overlap = None, 0
    for ts, te, label in turns:
        o = min(end, te) - max(start, ts)
        if o > overlap:
            best, overlap = label, o
    return best


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
    segments, info = model.transcribe(path, language=language or None, beam_size=BEAM, vad_filter=True, condition_on_previous_text=False)
    duration = max(info.duration, 0.001)
    log(f"job {job_id}: language={info.language} p={info.language_probability:.2f} audio={duration:.0f}s")
    raw, last_report = [], 0.0
    for seg in segments:
        text = seg.text.strip()
        if text:
            raw.append({"start": int(seg.start * 1000), "end": int(seg.end * 1000), "text": text, "speaker": None})
        if time.time() - last_report > 5:
            last_report = time.time()
            with conn.transaction():
                conn.execute("""UPDATE "TranscriptionJob" SET progress = %s WHERE id = %s""", (min(seg.end / duration, 0.99), job_id))
    turns = diarize(path)
    for s in raw:
        s["speaker"] = speaker_for(s["start"], s["end"], turns) if turns else None
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
