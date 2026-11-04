import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";
import { AuthzError } from "@/lib/authz";
import { locateQuote, type Span } from "@/lib/ai/quote";
import { tagSelect } from "@/server/queries/tags";
import { getModel, ModelError, type SuggestionModel, type TaxonomyTag, type TranscriptLine } from "@/server/ai/model";

/**
 * AI suggestions, suggestion-only (decisions D44, D59): the model proposes highlights for a
 * transcript and tags for a highlight; nothing becomes a highlight or a tag until a person accepts it.
 */

const ACTIVE = ["QUEUED", "RUNNING"] as const;
const STALE_MS = 20 * 60 * 1000; // a RUNNING job older than this died with its server process
const MAX_TRANSCRIPT_CHARS = 400_000; // roughly 100k tokens; far beyond a two-hour interview
const EXAMPLES_PER_TAG = 2;
const EXAMPLE_CHARS = 240;

export const aiEnabled = () => getModel() !== null;

// ---------- taxonomy ----------

type Taxonomy = { tags: TaxonomyTag[]; idOf: Map<string, string>; keyOf: Map<string, string> };

/**
 * Active tags with descriptions and a few accepted examples each. Keys are short (t1, t2…) so the
 * model never has to copy ids. Examples come only from OPEN projects or the project being worked
 * on, so a model "reason" can never echo a restricted study to someone outside it.
 */
async function taxonomy(projectId: string): Promise<Taxonomy> {
  const tags = await db.tag.findMany({
    where: { archivedAt: null },
    orderBy: [{ group: { position: "asc" } }, { name: "asc" }],
    select: { id: true, name: true, description: true, group: { select: { name: true } } },
  });
  const examples = await db.$queryRaw<{ tagId: string; text: string }[]>`
    SELECT t."tagId", t.text FROM (
      SELECT ht."tagId", h.text, row_number() OVER (PARTITION BY ht."tagId" ORDER BY h."createdAt" DESC) AS rn
      FROM "HighlightTag" ht
      JOIN "Highlight" h ON h.id = ht."highlightId" AND h.status = 'ACTIVE'
      JOIN "Source" s ON s.id = h."sourceId"
      JOIN "Project" p ON p.id = s."projectId"
      WHERE p.access = 'OPEN' OR p.id = ${projectId}
    ) t WHERE t.rn <= ${EXAMPLES_PER_TAG}`;
  const byTag = new Map<string, string[]>();
  for (const e of examples) byTag.set(e.tagId, [...(byTag.get(e.tagId) ?? []), e.text.length > EXAMPLE_CHARS ? `${e.text.slice(0, EXAMPLE_CHARS)}…` : e.text]);
  const idOf = new Map<string, string>();
  const keyOf = new Map<string, string>();
  const out = tags.map((t, i) => {
    const key = `t${i + 1}`;
    idOf.set(key, t.id);
    keyOf.set(t.id, key);
    return { key, name: t.name, group: t.group?.name ?? null, description: t.description, examples: byTag.get(t.id) ?? [] };
  });
  return { tags: out, idOf, keyOf };
}

const toIds = (tx: Taxonomy, keys: string[]) => [...new Set(keys.map((k) => tx.idOf.get(k.trim())).filter((x): x is string => !!x))].slice(0, 3);

function requireModel(): SuggestionModel {
  const m = getModel();
  if (!m) throw new AuthzError("AI suggestions are not configured on this server.");
  return m;
}

// ---------- highlight proposals for a transcript ----------

/** Queues a proposal run for a source and starts it once the response is sent. Reuses an active run. */
export async function startHighlightJob(sourceId: string, requestedById: string | null) {
  const model = requireModel();
  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId }, select: { _count: { select: { segments: true } } } });
  if (!source._count.segments) throw new AuthzError("This source has no transcript yet.");
  const active = await db.suggestionJob.findFirst({ where: { sourceId, status: { in: [...ACTIVE] } }, select: { id: true, startedAt: true } });
  if (active) {
    if (!(active.startedAt && Date.now() - active.startedAt.getTime() > STALE_MS)) return active;
    await db.suggestionJob.update({ where: { id: active.id }, data: { status: "FAILED", error: "The run was interrupted.", finishedAt: new Date() } });
  }
  const job = await db.suggestionJob.create({ data: { sourceId, requestedById, model: model.name }, select: { id: true } });
  after(() => runHighlightJob(job.id));
  return job;
}

/**
 * Runs once per job (the QUEUED→RUNNING claim is atomic). Replaces the source's pending proposals,
 * keeps accepted and rejected ones, and drops anything that cannot be anchored to the text verbatim.
 */
export async function runHighlightJob(jobId: string, model: SuggestionModel | null = getModel()) {
  const claimed = await db.suggestionJob.updateMany({ where: { id: jobId, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date() } });
  if (!claimed.count) return;
  try {
    if (!model) throw new ModelError("AI suggestions are not configured on this server.");
    const job = await db.suggestionJob.findUniqueOrThrow({ where: { id: jobId }, select: { sourceId: true } });
    const source = await db.source.findUniqueOrThrow({
      where: { id: job.sourceId },
      select: {
        id: true, title: true, projectId: true, project: { select: { name: true } },
        segments: { orderBy: { order: "asc" }, select: { id: true, speaker: true, text: true } },
        highlights: { where: { status: "ACTIVE" }, select: { startSegmentId: true, startOffset: true, endSegmentId: true, endOffset: true } },
        suggestions: { where: { status: { in: ["REJECTED", "ACCEPTED"] } }, select: { segmentId: true, quote: true } },
      },
    });
    const lines: TranscriptLine[] = source.segments.map((s, i) => ({ line: i + 1, speaker: s.speaker, text: s.text }));
    if (lines.reduce((n, l) => n + l.text.length, 0) > MAX_TRANSCRIPT_CHARS) throw new ModelError("This transcript is too long for one suggestion pass.");
    const tx = await taxonomy(source.projectId);
    if (!tx.tags.length) throw new ModelError("There are no active tags to suggest from.");

    const proposals = await model.proposeHighlights({ study: source.project.name, source: source.title, lines, tags: tx.tags });

    const segIndex = new Map(source.segments.map((s, i) => [s.id, i]));
    const taken = new Map<string, Span[]>(); // per segment: existing highlights plus accepted proposals
    const take = (segId: string, sp: Span) => taken.set(segId, [...(taken.get(segId) ?? []), sp]);
    for (const h of source.highlights) {
      const a = segIndex.get(h.startSegmentId)!;
      const b = segIndex.get(h.endSegmentId)!;
      for (let i = a; i <= b; i++) {
        const seg = source.segments[i];
        take(seg.id, { start: i === a ? h.startOffset : 0, end: i === b ? h.endOffset : seg.text.length });
      }
    }
    const reviewed = new Set(source.suggestions.map((s) => `${s.segmentId}\u0000${s.quote}`));
    const overlaps = (segId: string, sp: Span) => (taken.get(segId) ?? []).some((t) => sp.start < t.end && t.start < sp.end);

    const rows = [];
    for (const p of proposals) {
      const seg = source.segments[p.line - 1];
      if (!seg) continue;
      const span = locateQuote(seg.text, p.quote);
      if (!span || span.end - span.start < 3) continue;
      const quote = seg.text.slice(span.start, span.end);
      if (reviewed.has(`${seg.id}\u0000${quote}`) || overlaps(seg.id, span)) continue;
      take(seg.id, span);
      rows.push({ sourceId: source.id, jobId, segmentId: seg.id, startOffset: span.start, endOffset: span.end, quote, tagIds: toIds(tx, p.tags), reason: p.reason.slice(0, 500) || null });
    }

    await db.$transaction([
      db.highlightSuggestion.deleteMany({ where: { sourceId: source.id, status: "PENDING" } }),
      db.highlightSuggestion.createMany({ data: rows }),
      db.suggestionJob.update({ where: { id: jobId }, data: { status: "DONE", proposed: rows.length, finishedAt: new Date() } }),
    ]);
  } catch (e) {
    console.error("suggestion job failed", jobId, e);
    const message = e instanceof ModelError || e instanceof AuthzError ? e.message : "Something went wrong while asking the model.";
    await db.suggestionJob.update({ where: { id: jobId }, data: { status: "FAILED", error: message, finishedAt: new Date() } });
  }
}

/**
 * Starts proposals automatically for a transcript that came from in-app transcription and has not
 * been worked on: no highlights and no earlier suggestion run. Called when the source page renders.
 */
export async function maybeAutoSuggest(sourceId: string) {
  if (!aiEnabled() || process.env.AI_AUTO_SUGGEST === "off") return;
  const s = await db.source.findUnique({
    where: { id: sourceId },
    select: {
      _count: { select: { highlights: true, segments: true, suggestionJobs: true } },
      transcriptionJobs: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
    },
  });
  if (!s || s._count.highlights || !s._count.segments || s._count.suggestionJobs || s.transcriptionJobs[0]?.status !== "DONE") return;
  await startHighlightJob(sourceId, null);
}

/** Latest run plus the pending proposals, with tags resolved and archived ones dropped. */
export async function suggestionState(sourceId: string) {
  const [job, pending] = await Promise.all([
    db.suggestionJob.findFirst({ where: { sourceId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, error: true, proposed: true, model: true, startedAt: true, createdAt: true, finishedAt: true } }),
    db.highlightSuggestion.findMany({ where: { sourceId, status: "PENDING" }, orderBy: [{ segment: { order: "asc" } }, { startOffset: "asc" }], select: { id: true, segmentId: true, startOffset: true, endOffset: true, quote: true, reason: true, tagIds: true } }),
  ]);
  const tagIds = [...new Set(pending.flatMap((p) => p.tagIds))];
  const tags = new Map((await db.tag.findMany({ where: { id: { in: tagIds }, archivedAt: null }, select: tagSelect })).map((t) => [t.id, t]));
  const stale = job?.status === "RUNNING" && job.startedAt && Date.now() - job.startedAt.getTime() > STALE_MS;
  return {
    job: job ? { ...job, status: stale ? ("FAILED" as const) : job.status, error: stale ? "The run was interrupted; start it again." : job.error } : null,
    suggestions: pending.map(({ tagIds: ids, ...p }) => ({ ...p, tags: ids.map((id) => tags.get(id)).filter((t) => !!t) })),
  };
}
export type SuggestionState = Awaited<ReturnType<typeof suggestionState>>;

// ---------- tag suggestions for one highlight ----------

/** Asks the model for tags on one highlight; stores new ones as PENDING. Rejected tags are never proposed again. */
export async function suggestTagsFor(highlightId: string, model: SuggestionModel = requireModel()) {
  const h = await db.highlight.findUniqueOrThrow({
    where: { id: highlightId },
    select: {
      text: true, note: true, startSegmentId: true,
      source: { select: { projectId: true, project: { select: { name: true } } } },
      tags: { select: { tagId: true } },
      tagSuggestions: { select: { tagId: true } },
    },
  });
  const tx = await taxonomy(h.source.projectId);
  const start = await db.segment.findUniqueOrThrow({ where: { id: h.startSegmentId }, select: { sourceId: true, order: true } });
  const around = await db.segment.findMany({
    where: { sourceId: start.sourceId, order: { gte: start.order - 2, lte: start.order + 2 } },
    orderBy: { order: "asc" }, select: { order: true, speaker: true, text: true },
  });
  const current = h.tags.map((t) => tx.keyOf.get(t.tagId)).filter((k): k is string => !!k);
  const proposed = await model.suggestTags({
    study: h.source.project.name, quote: h.text, note: h.note, tags: tx.tags, current,
    context: around.map((s) => ({ line: s.order + 1, speaker: s.speaker, text: s.text })),
  });
  const known = new Set([...h.tags.map((t) => t.tagId), ...h.tagSuggestions.map((t) => t.tagId)]);
  const rows = [];
  for (const p of proposed) {
    const tagId = tx.idOf.get(p.tag.trim());
    if (!tagId || known.has(tagId)) continue;
    known.add(tagId);
    rows.push({ highlightId, tagId, reason: p.reason.slice(0, 300) || null });
    if (rows.length === 3) break;
  }
  if (rows.length) await db.tagSuggestion.createMany({ data: rows, skipDuplicates: true });
  return rows.length;
}
