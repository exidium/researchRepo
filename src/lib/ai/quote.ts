/**
 * Finds a quoted span inside one segment's text. Used to anchor model output (which quotes the
 * transcript) and to re-find a pending suggestion after the segment was edited. Pure; runs on
 * server and client.
 *
 * Exact matches win; otherwise the match ignores case, runs of whitespace and curly/straight
 * quote differences. When the quote occurs more than once, the occurrence nearest `hint` wins.
 */
export type Span = { start: number; end: number };

const FOLD: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-" };

/** Lower-cased text with whitespace runs collapsed, plus a map from each output char to its source index. */
function normalize(s: string) {
  let out = "";
  const map: number[] = [];
  let lastSpace = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (lastSpace || out.length === 0) continue;
      out += " ";
      map.push(i);
      lastSpace = true;
      continue;
    }
    out += (FOLD[c] ?? c).toLowerCase();
    map.push(i);
    lastSpace = false;
  }
  if (out.endsWith(" ")) { out = out.slice(0, -1); map.pop(); }
  return { out, map };
}

function occurrences(hay: string, needle: string) {
  const hits: number[] = [];
  if (!needle) return hits;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) hits.push(i);
  return hits;
}

const nearest = (hits: number[], hint: number) => hits.reduce((best, h) => (Math.abs(h - hint) < Math.abs(best - hint) ? h : best), hits[0]);

export function locateQuote(text: string, quote: string, hint = 0): Span | null {
  const q = quote.trim();
  if (!q) return null;
  const exact = occurrences(text, q);
  if (exact.length) {
    const start = nearest(exact, hint);
    return { start, end: start + q.length };
  }
  const t = normalize(text);
  const n = normalize(q);
  const hits = occurrences(t.out, n.out);
  if (!hits.length) return null;
  const hintN = t.map.findIndex((i) => i >= hint);
  const at = nearest(hits, hintN === -1 ? t.out.length : hintN);
  return { start: t.map[at], end: t.map[at + n.out.length - 1] + 1 };
}
