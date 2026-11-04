/**
 * Runs the suggestion pipeline against the seeded local database with a scripted model, so the
 * anchoring, filtering and privacy rules are tested without calling an API. Needs `pnpm db:seed`.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SuggestionModel, TaxonomyTag } from "@/server/ai/model";

const d = describe.skipIf(!process.env.DATABASE_URL);

d("AI suggestions against the seeded database", async () => {
  const { db } = await import("@/lib/db");
  const { runHighlightJob, suggestTagsFor } = await import("@/server/suggestions");
  const { systemPrompt } = await import("@/server/ai/model");
  let sourceId: string;
  let segIds: string[];
  let seenTags: TaxonomyTag[] = [];
  let openTexts: string[];

  const lines = [
    "Can you tell me about your workflow?",
    "Honestly we export everything to Excel. The tool “forgets” my settings every time.",
    "I gave up searching the site and asked our FAE instead.",
  ];

  beforeAll(async () => {
    const project = await db.project.findFirstOrThrow({ where: { access: "OPEN" } });
    const src = await db.source.create({ data: { projectId: project.id, title: "AI suggestion test", status: "READY" } });
    sourceId = src.id;
    segIds = [];
    for (const [i, text] of lines.entries()) {
      segIds.push((await db.segment.create({ data: { sourceId, order: i, speaker: i === 0 ? "Interviewer" : "Participant", text } })).id);
    }
    // An existing highlight on line 3 ("asked our FAE instead") must block an overlapping proposal.
    const t = lines[2];
    await db.highlight.create({ data: { sourceId, startSegmentId: segIds[2], startOffset: t.indexOf("asked"), endSegmentId: segIds[2], endOffset: t.length, text: t.slice(t.indexOf("asked")) } });
    openTexts = (await db.highlight.findMany({ where: { source: { project: { access: "OPEN" } } }, select: { text: true } })).map((h) => h.text);
  });

  afterAll(async () => {
    await db.highlight.deleteMany({ where: { sourceId } });
    await db.source.delete({ where: { id: sourceId } });
  });

  const scripted = (proposals: Awaited<ReturnType<SuggestionModel["proposeHighlights"]>>): SuggestionModel => ({
    name: "scripted",
    async proposeHighlights({ tags }) { seenTags = tags; return proposals; },
    async suggestTags({ tags }) { return [{ tag: tags[0].key, reason: "first" }, { tag: "t9999", reason: "unknown" }, { tag: tags[0].key, reason: "dup" }]; },
  });

  it("anchors verbatim quotes, drops bad ones, keeps only known tags", async () => {
    const job = await db.suggestionJob.create({ data: { sourceId, model: "scripted" } });
    await runHighlightJob(job.id, scripted([
      { line: 2, quote: 'the tool "forgets" my settings every time', tags: ["t1", "t2", "nope"], reason: "Tool friction" },
      { line: 2, quote: "we export everything to Excel", tags: ["t3"], reason: "Spreadsheets" },
      { line: 2, quote: "we export everything to Excel", tags: ["t3"], reason: "duplicate" },
      { line: 3, quote: "asked our FAE", tags: [], reason: "overlaps an existing highlight" },
      { line: 3, quote: "words that are not in the line", tags: [], reason: "hallucinated" },
      { line: 99, quote: "Excel", tags: [], reason: "no such line" },
    ]));
    const after = await db.suggestionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("DONE");
    const rows = await db.highlightSuggestion.findMany({ where: { sourceId, status: "PENDING" }, orderBy: { startOffset: "asc" } });
    expect(rows.map((r) => r.quote)).toEqual(["we export everything to Excel", "The tool “forgets” my settings every time"].map((q) => lines[1].slice(lines[1].toLowerCase().indexOf(q.toLowerCase()), lines[1].toLowerCase().indexOf(q.toLowerCase()) + q.length)));
    for (const r of rows) expect(lines[1].slice(r.startOffset, r.endOffset)).toBe(r.quote);
    const tagCount = await db.tag.count({ where: { id: { in: rows.flatMap((r) => r.tagIds) } } });
    expect(tagCount).toBe(rows.flatMap((r) => r.tagIds).length);
    expect(rows[1].tagIds).toHaveLength(2);
    expect(after.proposed).toBe(2);
  });

  it("sends descriptions and never examples from restricted projects", () => {
    expect(seenTags.length).toBeGreaterThan(0);
    expect(seenTags.every((t) => t.description)).toBe(true);
    expect(systemPrompt(seenTags)).toContain("Means: ");
    const examples = seenTags.flatMap((t) => t.examples).map((e) => e.replace(/…$/, ""));
    expect(examples.length).toBeGreaterThan(0);
    for (const e of examples) expect(openTexts.some((t) => t.startsWith(e))).toBe(true);
  });

  it("a second run replaces pending proposals and skips rejected ones", async () => {
    const first = await db.highlightSuggestion.findFirstOrThrow({ where: { sourceId, status: "PENDING", quote: { contains: "Excel" } } });
    await db.highlightSuggestion.update({ where: { id: first.id }, data: { status: "REJECTED" } });
    const job = await db.suggestionJob.create({ data: { sourceId, model: "scripted" } });
    await runHighlightJob(job.id, scripted([{ line: 2, quote: "we export everything to Excel", tags: [], reason: "again" }]));
    expect(await db.highlightSuggestion.count({ where: { sourceId, status: "PENDING" } })).toBe(0);
    expect((await db.suggestionJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("DONE");
  });

  it("records model failures on the job", async () => {
    const job = await db.suggestionJob.create({ data: { sourceId, model: "scripted" } });
    const { ModelError } = await import("@/server/ai/model");
    await runHighlightJob(job.id, { name: "x", proposeHighlights: async () => { throw new ModelError("declined"); }, suggestTags: async () => [] });
    const j = await db.suggestionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(j.status).toBe("FAILED");
    expect(j.error).toBe("declined");
  });

  it("tag suggestions skip unknown and duplicate keys", async () => {
    const h = await db.highlight.findFirstOrThrow({ where: { sourceId } });
    expect(await suggestTagsFor(h.id, scripted([]))).toBe(1);
    expect(await suggestTagsFor(h.id, scripted([]))).toBe(0); // already suggested once; never twice
  });
});
