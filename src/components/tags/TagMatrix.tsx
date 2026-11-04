import Link from "next/link";
import { tagColor, type TagLike } from "@/lib/colors";
import { searchHref } from "@/lib/search-params";

type Props = {
  counts: { tagId: string; projectId: string; count: number }[];
  projects: { id: string; name: string; productArea: string | null }[];
  tags: (TagLike & { archivedAt: Date | null })[];
  groups: { id: string; name: string; color: string | null }[];
};

/**
 * Tags (rows, by group) × projects (columns): how often each tag was used in each study. Cell shade scales with
 * the count; every non-zero cell links to the search for that tag in that project. Unused tags are left out.
 */
export function TagMatrix({ counts, projects, tags, groups }: Props) {
  const cell = new Map(counts.map((c) => [`${c.tagId}|${c.projectId}`, c.count]));
  const rowTotal = new Map<string, number>();
  const colTotal = new Map<string, number>();
  for (const c of counts) {
    rowTotal.set(c.tagId, (rowTotal.get(c.tagId) ?? 0) + c.count);
    colTotal.set(c.projectId, (colTotal.get(c.projectId) ?? 0) + c.count);
  }
  const max = Math.max(1, ...counts.map((c) => c.count));
  const used = tags.filter((t) => rowTotal.get(t.id));
  const sections = [...groups.map((g) => ({ id: g.id as string | null, name: g.name })), { id: null, name: "Ungrouped" }]
    .map((g) => ({ ...g, tags: used.filter((t) => (t.group?.id ?? null) === g.id).sort((a, b) => (rowTotal.get(b.id) ?? 0) - (rowTotal.get(a.id) ?? 0)) }))
    .filter((g) => g.tags.length);
  const cols = projects.filter((p) => colTotal.get(p.id));

  if (!used.length) return <p className="text-sm text-muted-foreground">No tagged highlights yet.</p>;

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="text-sm">
        <thead className="sticky top-0 bg-background">
          <tr>
            <th className="min-w-56 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Tag</th>
            {cols.map((p) => (
              <th key={p.id} className="h-40 w-10 px-1 align-bottom">
                <Link href={`/projects/${p.id}`} className="block w-10 origin-bottom-left translate-x-5 -rotate-45 whitespace-nowrap text-left text-xs font-normal text-muted-foreground hover:text-foreground" title={p.name}>
                  {p.name.length > 34 ? p.name.slice(0, 33) + "…" : p.name}
                </Link>
              </th>
            ))}
            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Total</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((g) => (
            <SectionRows key={g.id ?? "none"} name={g.name} tags={g.tags} cols={cols} cell={cell} rowTotal={rowTotal} max={max} />
          ))}
          <tr className="border-t bg-muted/30 text-xs text-muted-foreground">
            <td className="px-3 py-1.5 font-medium">Tag uses per project</td>
            {cols.map((p) => <td key={p.id} className="text-center tabular-nums">{colTotal.get(p.id)}</td>)}
            <td className="px-3 text-right tabular-nums">{counts.reduce((a, c) => a + c.count, 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SectionRows({ name, tags, cols, cell, rowTotal, max }: { name: string; tags: Props["tags"]; cols: Props["projects"]; cell: Map<string, number>; rowTotal: Map<string, number>; max: number }) {
  return (
    <>
      <tr className="border-t bg-muted/40"><td colSpan={cols.length + 2} className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{name}</td></tr>
      {tags.map((t) => {
        const color = tagColor(t);
        return (
          <tr key={t.id} className="hover:bg-muted/30">
            <td className="px-3 py-1">
              <span className="flex items-center gap-2"><span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} /><span className="truncate">{t.name}</span></span>
            </td>
            {cols.map((p) => {
              const n = cell.get(`${t.id}|${p.id}`) ?? 0;
              return (
                <td key={p.id} className="p-0.5 text-center">
                  {n ? (
                    <Link
                      href={searchHref({ tagIds: [t.id], projectIds: [p.id] })}
                      title={`${n} highlight${n === 1 ? "" : "s"} tagged “${t.name}” in ${p.name}`}
                      className="block rounded py-1 text-xs tabular-nums hover:ring-1 hover:ring-foreground/40"
                      style={{ background: `color-mix(in oklab, ${color} ${Math.round(15 + 70 * (n / max))}%, transparent)` }}
                    >
                      {n}
                    </Link>
                  ) : <span className="block py-1 text-xs text-muted-foreground/40">·</span>}
                </td>
              );
            })}
            <td className="px-3 text-right text-xs tabular-nums">{rowTotal.get(t.id)}</td>
          </tr>
        );
      })}
    </>
  );
}
