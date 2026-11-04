"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { findKey, type FindState } from "./editor-extensions";

type Props = { editor: Editor; canEdit: boolean; onClose: () => void };

/**
 * Find (and, for editors, replace) inside one transcript. Matches stay within a line. Replacements are ordinary
 * editor transactions, so each changed line is saved and its highlights re-anchored like a typed edit; the new
 * text inherits the highlight of the text it replaces.
 */
export function FindBar({ editor, canEdit, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [state, setState] = useState<FindState>({ query: "", opts: {}, matches: [], current: 0 });
  const findRef = useRef<HTMLInputElement>(null);

  useEffect(() => { findRef.current?.focus(); findRef.current?.select(); }, []);

  // Keep the plugin's query in sync and mirror its state for the counter.
  useEffect(() => {
    editor.view.dispatch(editor.state.tr.setMeta(findKey, { query, opts: { caseSensitive, wholeWord }, current: 0 }));
  }, [editor, query, caseSensitive, wholeWord]);
  useEffect(() => {
    const sync = () => { const s = findKey.getState(editor.state); if (s) setState(s); };
    sync();
    editor.on("transaction", sync);
    return () => { editor.off("transaction", sync); editor.view.dispatch(editor.state.tr.setMeta(findKey, { query: "" })); };
  }, [editor]);

  const go = (index: number) => {
    const n = state.matches.length;
    if (!n) return;
    const i = ((index % n) + n) % n;
    editor.view.dispatch(editor.state.tr.setMeta(findKey, { current: i }));
    const m = state.matches[i];
    const dom = editor.view.domAtPos(m.from).node;
    (dom instanceof Element ? dom : dom.parentElement)?.scrollIntoView({ block: "center" });
  };

  const textWithMarks = (from: number, text: string) => {
    const marks = editor.state.doc.nodeAt(from)?.marks ?? [];
    return text ? editor.schema.text(text, marks) : null;
  };

  const replaceCurrent = () => {
    const m = state.matches[state.current];
    if (!m) return;
    const node = textWithMarks(m.from, replace);
    const tr = node ? editor.state.tr.replaceWith(m.from, m.to, node) : editor.state.tr.delete(m.from, m.to);
    editor.view.dispatch(tr);
  };

  const replaceAll = () => {
    if (!state.matches.length) return;
    const tr = editor.state.tr;
    // Back to front, so earlier positions stay valid.
    for (const m of [...state.matches].reverse()) {
      const node = textWithMarks(m.from, replace);
      if (node) tr.replaceWith(m.from, m.to, node); else tr.delete(m.from, m.to);
    }
    const n = state.matches.length;
    const lines = new Set(state.matches.map((m) => m.segmentId)).size;
    editor.view.dispatch(tr);
    toast.success(`Replaced ${n} occurrence${n === 1 ? "" : "s"} in ${lines} line${lines === 1 ? "" : "s"}`);
  };

  const onFindKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); go(state.current + (e.shiftKey ? -1 : 1)); }
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  const toggle = (on: boolean, set: (v: boolean) => void, label: string, title: string) => (
    <button type="button" title={title} aria-pressed={on} onClick={() => set(!on)} className={cn("h-7 rounded px-1.5 text-xs font-medium", on ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>{label}</button>
  );

  return (
    <div className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-lg border bg-popover p-2 shadow-sm" role="search" aria-label="Find in transcript">
      <div className="flex items-center gap-1">
        <Input ref={findRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onFindKey} placeholder="Find in transcript" aria-label="Find" className="h-7 w-48" />
        {toggle(caseSensitive, setCaseSensitive, "Aa", "Match case")}
        {toggle(wholeWord, setWholeWord, "W", "Whole word")}
        <span className="w-16 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">{query ? (state.matches.length ? `${state.current + 1} of ${state.matches.length}` : "no match") : ""}</span>
        <Button type="button" size="icon-xs" variant="ghost" aria-label="Previous match" disabled={!state.matches.length} onClick={() => go(state.current - 1)}><ChevronUp className="size-4" /></Button>
        <Button type="button" size="icon-xs" variant="ghost" aria-label="Next match" disabled={!state.matches.length} onClick={() => go(state.current + 1)}><ChevronDown className="size-4" /></Button>
      </div>
      {canEdit ? (
        <div className="flex items-center gap-1">
          <Input value={replace} onChange={(e) => setReplace(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); replaceCurrent(); } if (e.key === "Escape") onClose(); }} placeholder="Replace with" aria-label="Replace with" className="h-7 w-44" />
          <Button type="button" size="xs" variant="outline" disabled={!state.matches.length} onClick={replaceCurrent}>Replace</Button>
          <Button type="button" size="xs" variant="outline" disabled={!state.matches.length} onClick={replaceAll}>Replace all</Button>
        </div>
      ) : null}
      <Button type="button" size="icon-xs" variant="ghost" className="ml-auto" aria-label="Close find" onClick={onClose}><X className="size-4" /></Button>
    </div>
  );
}
