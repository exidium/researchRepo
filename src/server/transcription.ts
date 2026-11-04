import "server-only";
import { db } from "@/lib/db";
import { AuthzError } from "@/lib/authz";

export const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "medium";
const ACTIVE = ["QUEUED", "RUNNING"] as const;

/**
 * Queues a transcription for a source's recording. Refuses when the source has highlights
 * (the transcript would replace the segments they anchor to, decision D20) or when a job is already active.
 */
export async function enqueueTranscription(sourceId: string, requestedById: string | null, opts: { language?: string | null } = {}) {
  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId }, select: { recordingPath: true, _count: { select: { highlights: true } } } });
  if (!source.recordingPath) throw new AuthzError("Upload a recording first");
  if (source._count.highlights > 0) throw new AuthzError("This source already has highlights; transcribing would replace them. Create a new source instead.");
  const active = await db.transcriptionJob.findFirst({ where: { sourceId, status: { in: [...ACTIVE] } }, select: { id: true } });
  if (active) return active;
  const job = await db.transcriptionJob.create({ data: { sourceId, requestedById, model: WHISPER_MODEL, language: opts.language ?? null }, select: { id: true } });
  await db.source.update({ where: { id: sourceId }, data: { status: "PROCESSING", errorMessage: null } });
  return job;
}

/** Latest job for a source plus its place in the queue. */
export async function transcriptionState(sourceId: string) {
  const job = await db.transcriptionJob.findFirst({ where: { sourceId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, progress: true, error: true, model: true, language: true, segmentCount: true, audioMs: true, createdAt: true, startedAt: true, finishedAt: true } });
  if (!job) return null;
  const ahead = job.status === "QUEUED" ? await db.transcriptionJob.count({ where: { status: { in: [...ACTIVE] }, createdAt: { lt: job.createdAt } } }) : 0;
  return { ...job, ahead };
}
export type TranscriptionState = NonNullable<Awaited<ReturnType<typeof transcriptionState>>>;
