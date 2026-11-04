/**
 * Find inside a transcript document. Pure, unit-tested. Matches never cross segment boundaries, because
 * a replacement must stay inside one segment to keep highlight anchors valid (decision D5).
 */
import type { Node as PMNode } from "@tiptap/pm/model";

export type Match = { from: number; to: number; segmentId: string };
export type FindOptions = { caseSensitive?: boolean; wholeWord?: boolean };

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findMatches(doc: PMNode, query: string, opts: FindOptions = {}): Match[] {
  if (!query) return [];
  const flags = opts.caseSensitive ? "g" : "gi";
  const body = escape(query);
  const re = new RegExp(opts.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body, flags + "u");
  const out: Match[] = [];
  doc.forEach((seg, offset) => {
    const text = seg.textContent;
    const start = offset + 1; // first position inside the segment
    for (const m of text.matchAll(re)) {
      if (!m[0]) continue;
      out.push({ from: start + m.index!, to: start + m.index! + m[0].length, segmentId: seg.attrs.segmentId });
    }
  });
  return out;
}

/** Index of the first match at or after `pos`, wrapping to 0. */
export function nextIndex(matches: Match[], pos: number): number {
  const i = matches.findIndex((m) => m.from >= pos);
  return i === -1 ? 0 : i;
}
