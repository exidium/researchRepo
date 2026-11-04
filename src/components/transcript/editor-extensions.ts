import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Extension } from "@tiptap/core";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { findMatches, type FindOptions, type Match } from "@/lib/transcript/find";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { SegmentNode } from "@/lib/transcript/schema";
import { formatClock } from "@/lib/transcript/time";
import { segmentIdsOf } from "@/lib/transcript/doc";
import { locateQuote } from "@/lib/ai/quote";

export type SegmentViewOptions = {
  onSpeakerClick?: (segmentId: string, anchor: HTMLElement, editor: Editor) => void;
  onTimeClick?: (startMs: number) => void;
};

/**
 * Editor-side segment node: plain-DOM node view (a transcript can have thousands of segments),
 * keyboard rules and a transaction filter that together forbid splitting, merging or deleting
 * segments (decision D6). Only the text inside a segment and its attributes can change.
 */
export const SegmentView = SegmentNode.extend<SegmentViewOptions>({
  addOptions() {
    return { onSpeakerClick: undefined, onTimeClick: undefined };
  },

  addNodeView() {
    const opts = this.options;
    const editor = this.editor;
    return ({ node }) => {
      let current: PMNode = node;
      const dom = document.createElement("div");
      dom.className = "segment";
      const gutter = document.createElement("div");
      gutter.className = "segment-gutter";
      gutter.contentEditable = "false";
      const speakerBtn = document.createElement("button");
      speakerBtn.type = "button";
      speakerBtn.className = "segment-speaker";
      const timeBtn = document.createElement("button");
      timeBtn.type = "button";
      timeBtn.className = "segment-time";
      gutter.append(speakerBtn, timeBtn);
      const contentDOM = document.createElement("div");
      contentDOM.className = "segment-text";
      dom.append(gutter, contentDOM);

      const render = (n: PMNode) => {
        dom.dataset.segmentId = n.attrs.segmentId;
        speakerBtn.textContent = n.attrs.speaker ?? "—";
        speakerBtn.title = n.attrs.speaker ? `Speaker: ${n.attrs.speaker}` : "Set speaker";
        timeBtn.textContent = n.attrs.startMs != null ? formatClock(n.attrs.startMs) : "";
        timeBtn.hidden = n.attrs.startMs == null;
      };
      render(node);
      speakerBtn.addEventListener("mousedown", (e) => e.preventDefault());
      speakerBtn.addEventListener("click", (e) => { e.preventDefault(); opts.onSpeakerClick?.(current.attrs.segmentId, speakerBtn, editor); });
      timeBtn.addEventListener("mousedown", (e) => e.preventDefault());
      timeBtn.addEventListener("click", (e) => { e.preventDefault(); if (current.attrs.startMs != null) opts.onTimeClick?.(current.attrs.startMs); });

      return {
        dom,
        contentDOM,
        update(n: PMNode) {
          if (n.type !== node.type) return false;
          current = n;
          render(n);
          return true;
        },
        ignoreMutation(m) {
          if (m.type === "selection") return false;
          return !contentDOM.contains(m.target);
        },
      };
    };
  },

  addKeyboardShortcuts() {
    const atStart = () => { const { empty, $from } = this.editor.state.selection; return empty && $from.parentOffset === 0; };
    const atEnd = () => { const { empty, $from } = this.editor.state.selection; return empty && $from.parentOffset === $from.parent.content.size; };
    return {
      Enter: () => true,
      "Shift-Enter": () => true,
      "Mod-Enter": () => true,
      Backspace: () => atStart(),
      "Mod-Backspace": () => atStart(),
      Delete: () => atEnd(),
      "Mod-Delete": () => atEnd(),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction(tr, state) {
          if (!tr.docChanged) return true;
          if (tr.doc.childCount !== state.doc.childCount) return false;
          const before = segmentIdsOf(state.doc);
          const after = segmentIdsOf(tr.doc);
          for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) return false;
          return true;
        },
      }),
    ];
  },
});

// ---------- find and replace ----------


export type FindState = { query: string; opts: FindOptions; matches: Match[]; current: number };
export const findKey = new PluginKey<FindState>("find");

/** Keeps the current search's matches up to date as the document changes, and paints them. */
export const FindHighlight = Extension.create({
  name: "findHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({ query: "", opts: {}, matches: [], current: 0 }),
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(findKey) as Partial<FindState> | undefined;
            if (!meta && !tr.docChanged) return prev;
            const query = meta?.query ?? prev.query;
            const opts = meta?.opts ?? prev.opts;
            const matches = findMatches(state.doc, query, opts);
            const current = meta?.current ?? Math.min(prev.current, Math.max(0, matches.length - 1));
            return { query, opts, matches, current };
          },
        },
        props: {
          decorations(state) {
            const s = findKey.getState(state);
            if (!s?.matches.length) return null;
            return DecorationSet.create(state.doc, s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.current ? "find-match find-current" : "find-match" })));
          },
        },
      }),
    ];
  },
});

// ---------- AI suggestions (proposed highlights awaiting review) ----------

export type SuggestionMark = { id: string; segmentId: string; startOffset: number; quote: string };
type SuggestState = { items: SuggestionMark[]; selected: string | null; ranges: { id: string; from: number; to: number }[] };
export const suggestKey = new PluginKey<SuggestState>("suggestions");

/** Absolute ranges of each suggestion, found by quote in its segment so edits never misplace them. */
export function suggestionRanges(doc: PMNode, items: SuggestionMark[]) {
  const pos = new Map<string, { node: PMNode; pos: number }>();
  doc.forEach((node, offset) => pos.set(node.attrs.segmentId, { node, pos: offset }));
  const out: { id: string; from: number; to: number }[] = [];
  for (const s of items) {
    const seg = pos.get(s.segmentId);
    if (!seg) continue;
    const span = locateQuote(seg.node.textContent, s.quote, s.startOffset);
    if (span) out.push({ id: s.id, from: seg.pos + 1 + span.start, to: seg.pos + 1 + span.end });
  }
  return out;
}

/** Paints proposed highlights with a dashed underline; set items/selected via a `suggestKey` meta. */
export const SuggestionMarks = Extension.create({
  name: "suggestionMarks",
  addProseMirrorPlugins() {
    return [
      new Plugin<SuggestState>({
        key: suggestKey,
        state: {
          init: () => ({ items: [], selected: null, ranges: [] }),
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(suggestKey) as Partial<Omit<SuggestState, "ranges">> | undefined;
            if (!meta && !tr.docChanged) return prev;
            const items = meta?.items ?? prev.items;
            const selected = meta && "selected" in meta ? meta.selected ?? null : prev.selected;
            return { items, selected, ranges: meta?.items || tr.docChanged ? suggestionRanges(state.doc, items) : prev.ranges };
          },
        },
        props: {
          decorations(state) {
            const s = suggestKey.getState(state);
            if (!s?.ranges.length) return null;
            return DecorationSet.create(state.doc, s.ranges.map((r) => Decoration.inline(r.from, r.to, {
              class: r.id === s.selected ? "suggestion suggestion-selected" : "suggestion",
              "data-suggestion-id": r.id,
            })));
          },
        },
      }),
    ];
  },
});
