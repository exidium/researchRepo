"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { UndoRedo } from "@tiptap/extensions";
import { Text } from "@tiptap/extension-text";
import type { Transaction } from "@tiptap/pm/state";
import { toast } from "sonner";
import { HighlightMark, TranscriptDoc } from "@/lib/transcript/schema";
import { anchorsFromSelection, buildTranscriptDoc, findSegment, markRangesOfSegment, trimSelection, type DocSegment } from "@/lib/transcript/doc";
import { highlightColor, type TagLike } from "@/lib/colors";
import { usePlayer } from "@/stores/player";
import { createHighlight, deleteHighlight, renameSpeaker, saveSegment, setHighlightNote, setHighlightTags } from "@/server/actions/highlights";
import { FindHighlight, SegmentView } from "./editor-extensions";
import { FindBar } from "./FindBar";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HighlightPanel } from "./HighlightPanel";
import { SelectionToolbar } from "./SelectionToolbar";
import { SpeakerPopover, type SpeakerTarget } from "./SpeakerPopover";
import { toClient, type ClientHighlight, type HighlightRow } from "./types";

type Props = {
  sourceId: string;
  segments: (DocSegment & { version: number })[];
  highlights: HighlightRow[];
  tags: TagLike[];
  participants: { id: string; name: string }[];
  canEdit: boolean;
  hasRecording: boolean;
};

const SAVE_DELAY = 600;
const SKIP = "skipSave";

export function TranscriptEditor({ sourceId, segments, highlights: initial, tags: initialTags, participants, canEdit, hasRecording }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const [highlights, setHighlights] = useState<ClientHighlight[]>(() => initial.map(toClient));
  const [tags, setTags] = useState<TagLike[]>(initialTags);
  const [selectedId, setSelectedId] = useState<string | null>(search.get("highlight"));
  const [findOpen, setFindOpen] = useState(false);
  const [toolbar, setToolbar] = useState<{ top: number; left: number } | null>(null);
  const [speakerTarget, setSpeakerTarget] = useState<SpeakerTarget | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const versions = useRef(new Map(segments.map((s) => [s.id, s.version])));
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const segmentOrder = useMemo(() => new Map(segments.map((s) => [s.id, s.order])), [segments]);
  const seek = usePlayer((s) => s.seek);
  const currentMs = usePlayer((s) => s.currentMs);

  const colorOf = useCallback((h: ClientHighlight) => highlightColor(h.tags), []);
  // Initial document only; later changes flow through editor transactions, never a rebuild.
  const [content] = useState(() => buildTranscriptDoc(segments, initial.map(toClient).map((h) => ({ ...h, color: highlightColor(h.tags) }))));

  const mergeHighlights = useCallback((rows: HighlightRow[]) => {
    setHighlights((prev) => {
      const map = new Map(prev.map((h) => [h.id, h]));
      for (const r of rows) map.set(r.id, toClient(r));
      return [...map.values()];
    });
  }, []);

  // ---- saving edited segments ----
  const flush = useCallback(async (editor: Editor, segmentId: string) => {
    timers.current.delete(segmentId);
    const found = findSegment(editor.state.doc, segmentId);
    if (!found) return;
    const res = await saveSegment({ segmentId, version: versions.current.get(segmentId) ?? 1, text: found.node.textContent, marks: markRangesOfSegment(found.node) });
    if (!res.ok) {
      toast.error(res.error);
      if (/reload/i.test(res.error)) router.refresh();
      return;
    }
    versions.current.set(segmentId, res.data.version);
    mergeHighlights(res.data.highlights);
  }, [mergeHighlights, router]);

  const scheduleSaves = useCallback((editor: Editor, tr: Transaction) => {
    if (!tr.docChanged || tr.getMeta(SKIP)) return;
    const dirty = new Set<string>();
    const doc = tr.doc;
    const note = (pos: number) => {
      const p = Math.max(0, Math.min(pos, doc.content.size));
      let $p = doc.resolve(p);
      if ($p.depth < 1 && p > 0) $p = doc.resolve(p - 1);
      if ($p.depth >= 1) dirty.add($p.node(1).attrs.segmentId);
    };
    tr.mapping.maps.forEach((map) => map.forEach((_a, _b, ns, ne) => { note(ns); note(ne); }));
    for (const id of dirty) {
      const t = timers.current.get(id);
      if (t) clearTimeout(t);
      timers.current.set(id, setTimeout(() => void flush(editor, id), SAVE_DELAY));
    }
  }, [flush]);

  // ---- toolbar placement ----
  const updateToolbar = useCallback((editor: Editor) => {
    const { from, to, empty } = editor.state.selection;
    if (empty || !canEdit || !containerRef.current) { setToolbar(null); return; }
    const start = editor.view.coordsAtPos(from);
    const box = containerRef.current.getBoundingClientRect();
    setToolbar({ top: start.top - box.top - 6, left: Math.max(0, start.left - box.left) });
    void to;
  }, [canEdit]);

  const onSpeakerClick = useCallback((segmentId: string, anchor: HTMLElement, ed: Editor) => {
    const container = anchor.closest<HTMLElement>(".transcript-editor");
    if (!canEdit || !container) return;
    const box = container.getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    const speaker = findSegment(ed.state.doc, segmentId)?.node.attrs.speaker ?? null;
    const same = countSpeaker(ed, speaker);
    setSpeakerTarget({ segmentId, speaker, sameSpeakerCount: same, rect: { top: r.bottom - box.top + 4, left: r.left - box.left } });
  }, [canEdit]);

  const editor = useEditor({
    extensions: [
      TranscriptDoc,
      SegmentView.configure({
        onSpeakerClick,
        onTimeClick: (ms) => { if (hasRecording) seek(ms); },
      }),
      Text,
      HighlightMark,
      UndoRedo,
      FindHighlight,
    ],
    content,
    editable: canEdit,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor, transaction }) => scheduleSaves(editor, transaction),
    onSelectionUpdate: ({ editor }) => updateToolbar(editor),
    onBlur: () => setToolbar(null),
    editorProps: {
      attributes: { class: "transcript-prose", spellcheck: "false" },
      handleClick: (view, pos) => {
        const marks = view.state.doc.resolve(pos).marks().filter((m) => m.type.name === "highlight");
        if (marks.length) { setSelectedId(marks[0].attrs.highlightId); return false; }
        return false;
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (text == null) return false;
        view.dispatch(view.state.tr.insertText(text.replace(/\s*\n+\s*/g, " ")));
        return true;
      },
    },
  });
  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t); }, []);

  // EditorContent attaches the ProseMirror DOM a tick after the editor exists; DOM effects wait for it.
  const [domReady, setDomReady] = useState(false);
  useEffect(() => {
    if (!editor) return;
    let frame = 0;
    const check = () => { if (editor.view.dom.isConnected) setDomReady(true); else frame = requestAnimationFrame(check); };
    check();
    return () => cancelAnimationFrame(frame);
  }, [editor]);

  // ---- selected highlight: mark in editor + scroll ----
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>("mark.hl[data-selected]").forEach((m) => m.removeAttribute("data-selected"));
    if (!selectedId) return;
    const marks = root.querySelectorAll<HTMLElement>(`mark.hl[data-highlight-id="${selectedId}"]`);
    marks.forEach((m) => (m.dataset.selected = "true"));
    marks[0]?.scrollIntoView({ block: "center", behavior: "smooth" });
    root.querySelector<HTMLElement>(`[data-highlight-item="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId, highlights, domReady]);

  // ---- ?segment= deep link from transcript search ----
  useEffect(() => {
    const id = search.get("segment");
    if (!id || !domReady) return;
    const el = containerRef.current?.querySelector<HTMLElement>(`.segment[data-segment-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.setAttribute("data-active", "true");
    const t = setTimeout(() => el.removeAttribute("data-active"), 2500);
    return () => clearTimeout(t);
  }, [search, domReady]);

  // ---- playback: mark the active segment ----
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !hasRecording) return;
    const active = findActiveSegment(segments, currentMs);
    root.querySelectorAll<HTMLElement>('.segment[data-active="true"]').forEach((el) => { if (el.dataset.segmentId !== active) el.removeAttribute("data-active"); });
    if (active) root.querySelector<HTMLElement>(`.segment[data-segment-id="${active}"]`)?.setAttribute("data-active", "true");
  }, [currentMs, segments, hasRecording]);

  // ---- highlight operations ----
  const addHighlight = async (tagIds: string[]) => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const sel = trimSelection(editor.state.doc, from, to);
    const anchors = sel && anchorsFromSelection(editor.state.doc, sel.from, sel.to);
    if (!sel || !anchors) return;
    const res = await createHighlight({ sourceId, ...anchors, tagIds });
    if (!res.ok) { toast.error(res.error); return; }
    const h = toClient(res.data);
    const mark = editor.schema.marks.highlight.create({ highlightId: h.id, color: colorOf(h) });
    editor.view.dispatch(editor.state.tr.addMark(sel.from, sel.to, mark).setMeta(SKIP, true));
    setHighlights((prev) => [...prev, h]);
    setSelectedId(h.id);
    setToolbar(null);
  };

  const recolor = (id: string, color: string | null) => {
    if (!editor) return;
    const tr = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      for (const m of node.marks) {
        if (m.type.name === "highlight" && m.attrs.highlightId === id && m.attrs.color !== color) {
          tr.removeMark(pos, pos + node.nodeSize, m);
          tr.addMark(pos, pos + node.nodeSize, m.type.create({ highlightId: id, color }));
        }
      }
    });
    if (tr.steps.length) editor.view.dispatch(tr.setMeta(SKIP, true));
  };

  const setNoteFor = async (id: string, note: string | null) => {
    const res = await setHighlightNote({ highlightId: id, note });
    if (!res.ok) { toast.error(res.error); return false; }
    mergeHighlights([res.data]);
    return true;
  };

  const setTagsFor = async (id: string, tagIds: string[]) => {
    const res = await setHighlightTags({ highlightId: id, tagIds });
    if (!res.ok) { toast.error(res.error); return; }
    const h = toClient(res.data);
    mergeHighlights([res.data]);
    recolor(id, colorOf(h));
  };

  const removeHighlight = async (id: string) => {
    const res = await deleteHighlight({ highlightId: id });
    if (!res.ok) { toast.error(res.error); return; }
    if (editor) {
      const tr = editor.state.tr;
      editor.state.doc.descendants((node, pos) => {
        if (!node.isText) return;
        for (const m of node.marks) if (m.type.name === "highlight" && m.attrs.highlightId === id) tr.removeMark(pos, pos + node.nodeSize, m);
      });
      if (tr.steps.length) editor.view.dispatch(tr.setMeta(SKIP, true));
    }
    setHighlights((prev) => prev.filter((h) => h.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const saveSpeaker = async (input: { speaker: string | null; participantId: string | null; scope: "one" | "all" }) => {
    if (!speakerTarget || !editor) return;
    const res = await renameSpeaker({ sourceId, segmentId: speakerTarget.segmentId, ...input });
    if (!res.ok) { toast.error(res.error); return; }
    const ids = new Set(res.data.segmentIds);
    const tr = editor.state.tr;
    editor.state.doc.forEach((node, pos) => { if (ids.has(node.attrs.segmentId)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, speaker: res.data.speaker }); });
    editor.view.dispatch(tr.setMeta(SKIP, true));
    setSpeakerTarget(null);
    toast.success(input.scope === "all" ? `Renamed ${ids.size} lines` : "Speaker updated");
  };

  // Cmd/Ctrl+F opens the transcript's own find bar instead of the browser's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); setFindOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div ref={containerRef} className="transcript-editor relative min-w-0" data-editable={canEdit} data-has-recording={hasRecording} onMouseDown={() => speakerTarget && setSpeakerTarget(null)}>
        {findOpen && editor ? <FindBar editor={editor} canEdit={canEdit} onClose={() => { setFindOpen(false); editor.commands.focus(); }} /> : (
          <div className="mb-2 flex justify-end">
            <Button type="button" size="xs" variant="ghost" className="text-muted-foreground" onClick={() => setFindOpen(true)}><Search className="size-3.5" /> {canEdit ? "Find and replace" : "Find"} <kbd className="ml-1 rounded border px-1 text-[10px]">⌘F</kbd></Button>
          </div>
        )}
        <EditorContent editor={editor} />
        {toolbar && editor ? <SelectionToolbar position={toolbar} allTags={tags} onHighlight={addHighlight} onTagCreated={(t) => setTags((p) => [...p, t])} /> : null}
        {speakerTarget ? <SpeakerPopover target={speakerTarget} participants={participants} onSave={saveSpeaker} onClose={() => setSpeakerTarget(null)} /> : null}
      </div>
      <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
        <HighlightPanel
          highlights={highlights}
          segmentOrder={segmentOrder}
          selectedId={selectedId}
          onSelect={setSelectedId}
          canEdit={canEdit}
          allTags={tags}
          onSetTags={setTagsFor}
          onDelete={removeHighlight}
          onSetNote={setNoteFor}
          onTagCreated={(t) => setTags((p) => [...p, t])}
        />
      </aside>
    </div>
  );
}

function countSpeaker(editor: Editor, speaker: string | null) {
  let n = 0;
  editor.state.doc.forEach((node) => { if (node.attrs.speaker === speaker) n++; });
  return n;
}

function findActiveSegment(segments: DocSegment[], ms: number): string | null {
  let active: DocSegment | null = null;
  for (const s of segments) {
    if (s.startMs == null) continue;
    if (s.startMs <= ms) active = s; else break;
  }
  if (!active) return null;
  if (active.endMs != null && ms >= active.endMs) return null;
  return active.id;
}
