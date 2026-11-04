"use client";

import { useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tagColor } from "@/lib/colors";
import { cn } from "@/lib/utils";
import type { ClientSuggestion } from "./types";

type Props = {
  suggestions: ClientSuggestion[];
  segmentOrder: Map<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAccept: (id: string, tagIds: string[]) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onRejectAll: () => Promise<void>;
};

/** Proposed highlights awaiting review. Nothing here is a highlight until accepted. */
export function SuggestionList({ suggestions, segmentOrder, selectedId, onSelect, onAccept, onReject, onRejectAll }: Props) {
  if (!suggestions.length) return null;
  const sorted = [...suggestions].sort((a, b) => (segmentOrder.get(a.segmentId) ?? 0) - (segmentOrder.get(b.segmentId) ?? 0) || a.startOffset - b.startOffset);
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-dashed border-violet-400/60 p-2" aria-label="Suggested highlights">
      <div className="flex items-center gap-1.5 px-1">
        <Sparkles className="size-3.5 text-violet-600" />
        <h2 className="text-sm font-medium">Suggested highlights</h2>
        <span className="text-xs text-muted-foreground">{suggestions.length}</span>
        <Button type="button" size="xs" variant="ghost" className="ml-auto text-muted-foreground" onClick={() => void onRejectAll()}>Dismiss all</Button>
      </div>
      <p className="px-1 text-xs text-muted-foreground">Proposed by AI from your tag list. Accept the ones worth keeping; only accepted ones become highlights.</p>
      <ul className="flex flex-col gap-2">
        {sorted.map((s) => <Item key={s.id} s={s} selected={s.id === selectedId} onSelect={onSelect} onAccept={onAccept} onReject={onReject} />)}
      </ul>
    </section>
  );
}

function Item({ s, selected, onSelect, onAccept, onReject }: { s: ClientSuggestion; selected: boolean } & Pick<Props, "onSelect" | "onAccept" | "onReject">) {
  const [kept, setKept] = useState(() => new Set(s.tags.map((t) => t.id)));
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  return (
    <li
      data-suggestion-item={s.id}
      className={cn("rounded-md border bg-background p-2 text-sm transition-colors", selected ? "border-violet-500/60 bg-violet-500/5" : "hover:bg-muted/50")}
      onClick={() => onSelect(s.id)}
    >
      <blockquote className="line-clamp-4 border-l-2 border-dashed border-violet-500/70 pl-2 text-[13px] leading-snug">{s.quote}</blockquote>
      {s.reason ? <p className="mt-1 text-xs text-muted-foreground">{s.reason}</p> : null}
      {s.tags.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {s.tags.map((t) => {
            const on = kept.has(t.id);
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                title={on ? "Click to leave this tag off" : "Click to keep this tag"}
                className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", on ? "" : "text-muted-foreground line-through opacity-60")}
                onClick={(e) => { e.stopPropagation(); setKept((prev) => { const n = new Set(prev); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; }); }}
              >
                <span className="size-2 rounded-full" style={{ background: tagColor(t) }} />{t.name}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="mt-2 flex gap-1">
        <Button type="button" size="xs" disabled={busy} onClick={(e) => { e.stopPropagation(); void act(() => onAccept(s.id, [...kept])); }}><Check className="size-3.5" /> Accept</Button>
        <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={(e) => { e.stopPropagation(); void act(() => onReject(s.id)); }}><X className="size-3.5" /> Dismiss</Button>
      </div>
    </li>
  );
}
