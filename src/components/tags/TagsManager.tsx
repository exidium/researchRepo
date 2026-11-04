"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, GitMerge, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmButton } from "@/components/shared/ConfirmButton";
import { colorFor, tagColor } from "@/lib/colors";
import { cn } from "@/lib/utils";
import {
  createTag, createTagGroup, deleteTag, deleteTagGroup, mergeTags, reorderTagGroups, setTagArchived, updateTag, updateTagGroup,
} from "@/server/actions/tags";

type Group = { id: string; name: string; color: string | null; position: number };
type Tag = { id: string; name: string; color: string | null; archivedAt: Date | null; description: string | null; externalIds: string[]; group: { id: string; name: string; color: string | null } | null; _count: { highlights: number } };
type Res = { ok: true } | { ok: false; error: string };

export function TagsManager({ groups, tags, canManage }: { groups: Group[]; tags: Tag[]; canManage: boolean }) {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const [pending, start] = useTransition();
  const [merge, setMerge] = useState<Tag | null>(null);
  const [newGroup, setNewGroup] = useState("");
  const [newTag, setNewTag] = useState<{ groupId: string | null; name: string } | null>(null);

  const run = (fn: () => Promise<Res>, ok?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) { toast.error(res.error); return; }
      if (ok) toast.success(ok);
      router.refresh();
    });

  const byGroup = useMemo(() => {
    const m = new Map<string | null, Tag[]>();
    for (const t of tags) {
      if (!showArchived && t.archivedAt) continue;
      const k = t.group?.id ?? null;
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return m;
  }, [tags, showArchived]);
  const archivedCount = tags.filter((t) => t.archivedAt).length;

  const section = (group: Group | null, index: number) => {
    const list = byGroup.get(group?.id ?? null) ?? [];
    if (!group && list.length === 0 && !newTag) return null;
    return (
      <section key={group?.id ?? "none"} className="rounded-lg border">
        <header className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
          <span className="size-2.5 rounded-full" style={{ background: group ? group.color ?? colorFor(group.name) : "#9ca3af" }} />
          {group ? (
            <InlineName value={group.name} canEdit={canManage} onSave={(name) => run(() => updateTagGroup({ id: group.id, name }), "Group renamed")} className="font-medium" />
          ) : <span className="font-medium text-muted-foreground">Ungrouped</span>}
          <span className="text-xs text-muted-foreground">{list.length}</span>
          {canManage && group ? (
            <span className="ml-auto flex items-center gap-0.5">
              <Button variant="ghost" size="icon-xs" aria-label="Move group up" disabled={index === 0 || pending} onClick={() => run(() => reorderTagGroups({ orderedIds: swap(groups.map((g) => g.id), index, index - 1) }))}><ArrowUp className="size-3.5" /></Button>
              <Button variant="ghost" size="icon-xs" aria-label="Move group down" disabled={index === groups.length - 1 || pending} onClick={() => run(() => reorderTagGroups({ orderedIds: swap(groups.map((g) => g.id), index, index + 1) }))}><ArrowDown className="size-3.5" /></Button>
              <Button variant="ghost" size="icon-xs" aria-label="Add tag to group" onClick={() => setNewTag({ groupId: group.id, name: "" })}><Plus className="size-3.5" /></Button>
              <ConfirmButton title={`Delete group “${group.name}”?`} description="Its tags are kept and become ungrouped." variant="ghost" size="icon-xs" ariaLabel={`Delete group ${group.name}`} onConfirm={() => deleteTagGroup({ id: group.id })}><Trash2 className="size-3.5" /></ConfirmButton>
            </span>
          ) : null}
        </header>
        <ul className="divide-y">
          {list.map((t) => (
            <li key={t.id} className={cn("grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-1.5 text-sm sm:grid-cols-[minmax(0,1fr)_120px_auto]", t.archivedAt && "opacity-60")}>
              <div className="flex min-w-0 items-center gap-2">
                {canManage ? (
                  <input type="color" aria-label={`Colour of ${t.name}`} value={t.color ?? tagColor(t)} className="size-4 shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0" onChange={(e) => run(() => updateTag({ id: t.id, color: e.target.value }))} />
                ) : <span className="size-2.5 shrink-0 rounded-full" style={{ background: tagColor(t) }} />}
                <div className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-center gap-2">
                    <InlineName value={t.name} canEdit={canManage && !t.archivedAt} onSave={(name) => run(() => updateTag({ id: t.id, name }), "Tag renamed")} />
                    {t.archivedAt ? <Badge variant="outline">archived</Badge> : null}
                  </span>
                  <Description value={t.description} tagName={t.name} canEdit={canManage && !t.archivedAt} onSave={(description) => run(() => updateTag({ id: t.id, description }), "Description saved")} />
                </div>
              </div>
              <span className="hidden text-right text-xs tabular-nums text-muted-foreground sm:block">{t._count.highlights} highlights</span>
              {canManage ? (
                <span className="flex items-center gap-0.5">
                  <Select value={t.group?.id ?? ""} onValueChange={(v) => run(() => updateTag({ id: t.id, groupId: (v as string) || null }))}>
                    <SelectTrigger size="sm" className="h-7 min-w-28 text-xs" aria-label="Group"><SelectValue>{(v: string) => groups.find((g) => g.id === v)?.name ?? "No group"}</SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">No group</SelectItem>
                      {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon-xs" aria-label={`Merge ${t.name} into another tag`} onClick={() => setMerge(t)}><GitMerge className="size-3.5" /></Button>
                  <Button variant="ghost" size="icon-xs" aria-label={t.archivedAt ? "Restore tag" : "Archive tag"} onClick={() => run(() => setTagArchived({ id: t.id, archived: !t.archivedAt }), t.archivedAt ? "Tag restored" : "Tag archived")}>
                    {t.archivedAt ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
                  </Button>
                  <ConfirmButton title={`Delete “${t.name}”?`} description={`Removes the tag from ${t._count.highlights} highlights. Prefer archiving unless the tag was a mistake.`} variant="ghost" size="icon-xs" ariaLabel={`Delete tag ${t.name}`} onConfirm={() => deleteTag({ id: t.id })}><Trash2 className="size-3.5" /></ConfirmButton>
                </span>
              ) : null}
            </li>
          ))}
          {newTag && newTag.groupId === (group?.id ?? null) ? (
            <li className="px-3 py-1.5">
              <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); run(() => createTag({ name: newTag.name, groupId: newTag.groupId }), "Tag created"); setNewTag(null); }}>
                <Input autoFocus value={newTag.name} onChange={(e) => setNewTag({ ...newTag, name: e.target.value })} placeholder="New tag name" className="h-7 max-w-xs" />
                <Button type="submit" size="xs" disabled={!newTag.name.trim()}>Add</Button>
                <Button type="button" size="xs" variant="ghost" onClick={() => setNewTag(null)}>Cancel</Button>
              </form>
            </li>
          ) : null}
        </ul>
      </section>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); run(() => createTagGroup({ name: newGroup }), "Group created"); setNewGroup(""); }}>
            <Input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="New group name" className="h-8 max-w-xs" aria-label="New group name" />
            <Button type="submit" size="sm" variant="outline" disabled={!newGroup.trim() || pending}><Plus className="size-4" /> Group</Button>
          </form>
        ) : null}
        {canManage ? <Button size="sm" variant="outline" onClick={() => setNewTag({ groupId: null, name: "" })}><Plus className="size-4" /> Tag</Button> : null}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setShowArchived((v) => !v)}>{showArchived ? "Hide" : "Show"} archived ({archivedCount})</Button>
      </div>
      {groups.map((g, i) => section(g, i))}
      {section(null, -1)}

      <Dialog open={!!merge} onOpenChange={(o) => { if (!o) setMerge(null); }}>
        <DialogContent>
          {merge ? <MergeForm source={merge} candidates={tags.filter((t) => t.id !== merge.id && !t.archivedAt)} onDone={() => setMerge(null)} run={run} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function swap(ids: string[], a: number, b: number) {
  const next = [...ids];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

function InlineName({ value, canEdit, onSave, className }: { value: string; canEdit: boolean; onSave: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return (
      <span className={cn("group/name flex min-w-0 items-center gap-1", className)}>
        <span className="truncate">{value}</span>
        {canEdit ? <button type="button" aria-label={`Rename ${value}`} className="opacity-0 group-hover/name:opacity-100" onClick={() => { setDraft(value); setEditing(true); }}><Pencil className="size-3 text-muted-foreground" /></button> : null}
      </span>
    );
  }
  return (
    <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (draft.trim() && draft.trim() !== value) onSave(draft.trim()); setEditing(false); }}>
      <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} className="h-7 w-56" onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }} />
      <Button type="submit" size="icon-xs" variant="ghost" aria-label="Save name"><Check className="size-3.5" /></Button>
      <Button type="button" size="icon-xs" variant="ghost" aria-label="Cancel rename" onClick={() => setEditing(false)}><X className="size-3.5" /></Button>
    </form>
  );
}

/** What the tag means, in one line. Researchers read it when tagging; AI suggestions rely on it. */
function Description({ value, tagName, canEdit, onSave }: { value: string | null; tagName: string; canEdit: boolean; onSave: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  if (editing) {
    return (
      <form className="mt-0.5 flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); const v = draft.trim() || null; if (v !== value) onSave(v); setEditing(false); }}>
        <Input autoFocus value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)} placeholder="When to use this tag, in one line" aria-label={`Description of ${tagName}`} className="h-7 w-full max-w-md text-xs" onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }} />
        <Button type="submit" size="icon-xs" variant="ghost" aria-label="Save description"><Check className="size-3.5" /></Button>
        <Button type="button" size="icon-xs" variant="ghost" aria-label="Cancel description" onClick={() => setEditing(false)}><X className="size-3.5" /></Button>
      </form>
    );
  }
  if (value) {
    return canEdit
      ? <button type="button" className="truncate text-left text-xs text-muted-foreground hover:text-foreground" title="Edit description" onClick={() => { setDraft(value); setEditing(true); }}>{value}</button>
      : <span className="truncate text-xs text-muted-foreground">{value}</span>;
  }
  return canEdit ? <button type="button" className="w-fit text-left text-xs text-muted-foreground/70 hover:text-foreground" onClick={() => { setDraft(""); setEditing(true); }}>Add description</button> : null;
}

function MergeForm({ source, candidates, onDone, run }: { source: Tag; candidates: Tag[]; onDone: () => void; run: (fn: () => Promise<Res>, ok?: string) => void }) {
  const [targetId, setTargetId] = useState("");
  const [q, setQ] = useState("");
  const list = candidates.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 50);
  const target = candidates.find((c) => c.id === targetId);
  return (
    <form className="contents" onSubmit={(e) => { e.preventDefault(); if (!targetId) return; run(() => mergeTags({ sourceId: source.id, targetId }), `Merged “${source.name}” into “${target?.name}”`); onDone(); }}>
      <DialogHeader>
        <DialogTitle>Merge “{source.name}”</DialogTitle>
        <DialogDescription>Every highlight tagged “{source.name}” ({source._count.highlights}) will be tagged with the target instead, and “{source.name}” is removed.</DialogDescription>
      </DialogHeader>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find the target tag…" autoFocus aria-label="Find target tag" />
      <ul className="max-h-64 overflow-y-auto rounded-md border text-sm" role="listbox" aria-label="Target tag">
        {list.map((c) => (
          <li key={c.id}>
            <button type="button" role="option" aria-selected={c.id === targetId} className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted", c.id === targetId && "bg-accent")} onClick={() => setTargetId(c.id)}>
              <span className="size-2.5 rounded-full" style={{ background: tagColor(c) }} />
              <span className="flex-1 truncate">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.group?.name ?? "—"} · {c._count.highlights}</span>
            </button>
          </li>
        ))}
        {!list.length ? <li className="px-3 py-2 text-muted-foreground">No tags match.</li> : null}
      </ul>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={!targetId}><GitMerge className="size-4" /> Merge into {target ? `“${target.name}”` : "…"}</Button>
      </DialogFooter>
    </form>
  );
}
