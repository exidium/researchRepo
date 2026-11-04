import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { transcriptExtensions } from "@/lib/transcript/schema";
import { buildTranscriptDoc } from "@/lib/transcript/doc";
import { findMatches, nextIndex } from "@/lib/transcript/find";

const schema = getSchema(transcriptExtensions);
const doc = PMNode.fromJSON(schema, buildTranscriptDoc([
  { id: "a", order: 0, speaker: "S1", startMs: 0, endMs: 1, text: "We use ADI sim and adi sim pro." },
  { id: "b", order: 1, speaker: "S2", startMs: 1, endMs: 2, text: "ADI" },
  { id: "c", order: 2, speaker: "S2", startMs: 2, endMs: 3, text: "sim is fine. Simulation too." },
], [{ id: "h", startSegmentId: "a", startOffset: 7, endSegmentId: "a", endOffset: 14, status: "ACTIVE" }]));

describe("findMatches", () => {
  it("finds case-insensitive matches with positions that map back to the text", () => {
    const m = findMatches(doc, "adi sim");
    expect(m.map((x) => x.segmentId)).toEqual(["a", "a"]);
    expect(m.map((x) => doc.textBetween(x.from, x.to))).toEqual(["ADI sim", "adi sim"]);
  });
  it("never matches across two lines", () => {
    expect(findMatches(doc, "ADI sim").every((x) => x.segmentId === "a")).toBe(true);
    expect(findMatches(doc, "ADIsim")).toEqual([]);
  });
  it("respects match case and whole word", () => {
    expect(findMatches(doc, "adi sim", { caseSensitive: true }).length).toBe(1);
    expect(findMatches(doc, "sim").length).toBe(4);
    expect(findMatches(doc, "sim", { wholeWord: true }).map((x) => doc.textBetween(x.from, x.to))).toEqual(["sim", "sim", "sim"]);
  });
  it("matches text that spans a highlight mark boundary as one match", () => {
    // "ADI sim" in line a is highlighted (offsets 7..14); "use ADI" crosses the mark start.
    const m = findMatches(doc, "use ADI");
    expect(m.length).toBe(1);
    expect(doc.textBetween(m[0].from, m[0].to)).toBe("use ADI");
  });
  it("treats regex characters literally and returns nothing for an empty query", () => {
    expect(findMatches(doc, "fine.").length).toBe(1);
    expect(findMatches(doc, ".*")).toEqual([]);
    expect(findMatches(doc, "")).toEqual([]);
  });
});

describe("nextIndex", () => {
  it("picks the first match at or after a position and wraps", () => {
    const m = findMatches(doc, "sim");
    expect(nextIndex(m, 0)).toBe(0);
    expect(nextIndex(m, m[1].from)).toBe(1);
    expect(nextIndex(m, 10_000)).toBe(0);
  });
});
