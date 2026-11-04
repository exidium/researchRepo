import path from "node:path";
import { readFile } from "node:fs/promises";
import { db } from "@/lib/db";
import { guardSource } from "@/server/api-auth";
import { replaceSegments } from "@/server/transcript/replace-segments";
import { enqueueTranscription } from "@/server/transcription";
import { MAX_RECORDING_BYTES, MAX_TRANSCRIPT_BYTES, TooLargeError, removeStored, resolveStored, writeSourceFile } from "@/lib/storage";
import { parseTranscriptFile, RECORDING_EXTENSIONS, RECORDING_MIME, TRANSCRIPT_EXTENSIONS } from "@/lib/transcript/parse-file";

/**
 * PUT /api/upload/[sourceId]/transcript|recording
 * Raw request body (not multipart, not a server action: see decisions D12/D13), streamed to disk.
 * Headers: content-type, x-filename (URL-encoded original name). Responds with JSON.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/upload/[sourceId]/[kind]">) {
  const { sourceId, kind } = await ctx.params;
  if (kind !== "transcript" && kind !== "recording") return Response.json({ error: "Unknown kind" }, { status: 404 });
  const guard = await guardSource(sourceId, "EDITOR");
  if (guard instanceof Response) return guard;

  const filename = decodeURIComponent(request.headers.get("x-filename") ?? "");
  const ext = path.extname(filename).toLowerCase();
  const allowed: readonly string[] = kind === "transcript" ? TRANSCRIPT_EXTENSIONS : RECORDING_EXTENSIONS;
  if (!allowed.includes(ext)) return Response.json({ error: `Unsupported file type ${ext || "(none)"}. Allowed: ${allowed.join(", ")}` }, { status: 415 });
  const max = kind === "transcript" ? MAX_TRANSCRIPT_BYTES : MAX_RECORDING_BYTES;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > max) return Response.json({ error: `File is larger than the ${Math.round(max / 1e6)} MB limit` }, { status: 413 });
  if (!request.body) return Response.json({ error: "Empty body" }, { status: 400 });

  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId }, select: { transcriptPath: true, recordingPath: true, _count: { select: { highlights: true } } } });
  if (kind === "transcript" && source._count.highlights > 0) {
    return Response.json({ error: "This source already has highlights. Delete them or create a new source before replacing the transcript." }, { status: 409 });
  }

  let stored: { rel: string; bytes: number };
  try {
    stored = await writeSourceFile(sourceId, `${kind}${ext}`, request.body, max);
  } catch (e) {
    if (e instanceof TooLargeError) return Response.json({ error: `File is larger than the ${Math.round(max / 1e6)} MB limit` }, { status: 413 });
    throw e;
  }

  if (kind === "recording") {
    if (source.recordingPath && source.recordingPath !== stored.rel) await removeStored(source.recordingPath);
    await db.source.update({ where: { id: sourceId }, data: { recordingPath: stored.rel, recordingName: filename, recordingMime: RECORDING_MIME[ext] ?? request.headers.get("content-type"), recordingBytes: BigInt(stored.bytes), durationMs: null } });
    // A recording on a source without a transcript is transcribed automatically (decision D54).
    const segments = await db.segment.count({ where: { sourceId } });
    let transcription: string | null = null;
    if (segments === 0 && source._count.highlights === 0) {
      await enqueueTranscription(sourceId, guard.user.id);
      transcription = "queued";
    }
    return Response.json({ ok: true, kind, bytes: stored.bytes, transcription });
  }

  // transcript: parse and replace segments
  if (source.transcriptPath && source.transcriptPath !== stored.rel) await removeStored(source.transcriptPath);
  await db.source.update({ where: { id: sourceId }, data: { transcriptPath: stored.rel, transcriptName: filename, status: "PROCESSING" } });
  try {
    const parsed = await parseTranscriptFile(ext, await readFile(resolveStored(stored.rel)));
    if (parsed.segments.length === 0) throw new Error("No segments found in the file");
    const n = await replaceSegments(sourceId, parsed);
    return Response.json({ ok: true, kind, bytes: stored.bytes, segments: n, transcriptKind: parsed.kind, warnings: parsed.warnings });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not parse transcript";
    await db.source.update({ where: { id: sourceId }, data: { status: "FAILED", errorMessage: message } });
    return Response.json({ error: message }, { status: 422 });
  }
}
