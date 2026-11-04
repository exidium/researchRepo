import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Plus, StickyNote } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccessBadge } from "@/components/shared/AccessBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { ProjectActions } from "@/components/projects/ProjectActions";
import { MembersPanel } from "@/components/projects/MembersPanel";
import { SourceDialog } from "@/components/sources/SourceDialog";
import { requirePageUser } from "@/lib/auth";
import { roleAtLeast } from "@/lib/authz";
import { formatDate, plural } from "@/lib/format";
import { getProjectForUser, listProductAreas } from "@/server/queries/projects";
import { tagProjectCounts, listTagsForPicker } from "@/server/queries/tags";
import { searchHref } from "@/lib/search-params";
import { tagColor } from "@/lib/colors";

export default async function ProjectPage({ params }: PageProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  const user = await requirePageUser();
  const [data, productAreas] = await Promise.all([getProjectForUser(user, projectId), listProductAreas()]);
  if (!data) notFound();
  const { project, role, participants, highlightCount } = data;
  const [tagCounts, allTags] = await Promise.all([tagProjectCounts(user, project.id), listTagsForPicker()]);
  const tagById = new Map(allTags.map((t) => [t.id, t]));
  const projectTags = tagCounts.map((c) => ({ tag: tagById.get(c.tagId), count: c.count })).filter((x) => x.tag).sort((a, b) => b.count - a.count);
  const canEdit = roleAtLeast(role, "EDITOR");
  const canAdmin = roleAtLeast(role, "ADMIN");
  const newSource = <SourceDialog projectId={project.id} trigger={<Button size="sm"><Plus className="size-4" /> New source</Button>} />;

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{project.name} <AccessBadge access={project.access} />{project.archivedAt ? <Badge variant="outline">Archived</Badge> : null}</span>}
        description={
          <span className="flex flex-wrap gap-x-3">
            {project.productArea ? <span>{project.productArea}</span> : null}
            {project.startDate ? <span>{formatDate(project.startDate)}{project.endDate ? ` – ${formatDate(project.endDate)}` : ""}</span> : null}
            <span>Owner {project.owner.name ?? project.owner.email}</span>
            <span>{plural(project.sources.length, "source")} · {plural(highlightCount, "highlight")}</span>
          </span>
        }
        actions={canAdmin ? <ProjectActions project={project} productAreas={productAreas} canDelete={user.isAdmin} /> : null}
      />
      <div className="grid gap-8 p-6 lg:grid-cols-[1fr_320px]">
        <section className="flex flex-col gap-6">
          {project.goal ? (
            <div>
              <h2 className="mb-1 text-sm font-medium">Goal</h2>
              <p className="whitespace-pre-line text-sm text-muted-foreground">{project.goal}</p>
            </div>
          ) : null}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium">Sources</h2>
              {canEdit ? newSource : null}
            </div>
            {project.sources.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Participants</TableHead>
                    <TableHead className="text-right">Segments</TableHead>
                    <TableHead className="text-right">Highlights</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {project.sources.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        <Link href={`/projects/${project.id}/sources/${s.id}`} className="flex items-center gap-2 hover:underline">
                          {s.kind === "NOTE" ? <StickyNote className="size-4 text-muted-foreground" /> : <FileText className="size-4 text-muted-foreground" />}
                          <span className="truncate">{s.title}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(s.date)}</TableCell>
                      <TableCell className="text-muted-foreground">{s.participants.map((p) => p.participant.name).join(", ") || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{s._count.segments}</TableCell>
                      <TableCell className="text-right tabular-nums">{s._count.highlights}</TableCell>
                      <TableCell><Badge variant={s.status === "READY" ? "secondary" : s.status === "FAILED" ? "destructive" : "outline"}>{s.status.toLowerCase()}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState title="No sources yet" hint="Add a session, then upload its transcript and recording." action={canEdit ? newSource : undefined} />
            )}
          </div>
        </section>
        <aside className="flex flex-col gap-6">
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-medium">Tags in this project</h2>
              {projectTags.length ? <Link href="/tags?view=projects" className="text-xs text-muted-foreground hover:underline">All projects</Link> : null}
            </div>
            {projectTags.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {projectTags.slice(0, 15).map(({ tag, count }) => (
                  <li key={tag!.id}>
                    <Link href={searchHref({ tagIds: [tag!.id], projectIds: [project.id] })} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/60">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: tagColor(tag!) }} />
                      <span className="flex-1 truncate">{tag!.name}</span>
                      <span className="tabular-nums text-xs text-muted-foreground">{count}</span>
                    </Link>
                  </li>
                ))}
                {projectTags.length > 15 ? <li className="px-1 text-xs text-muted-foreground">+{projectTags.length - 15} more</li> : null}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No tagged highlights yet.</p>}
          </div>
          <div>
            <h2 className="mb-2 text-sm font-medium">Participants</h2>
            {participants.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {participants.map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-2">
                    <Link href={`/participants/${p.id}`} className="truncate hover:underline">{p.name}</Link>
                    <span className="truncate text-xs text-muted-foreground">{[p.role, p.company].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">Participants are added on each source.</p>}
          </div>
          <div>
            <h2 className="mb-2 text-sm font-medium">Members</h2>
            <MembersPanel projectId={project.id} members={project.members} canManage={canAdmin} ownerEmail={project.owner.email} />
            {project.access === "OPEN" ? <p className="mt-2 text-xs text-muted-foreground">Open project: everyone can view; members get extra rights.</p> : <p className="mt-2 text-xs text-muted-foreground">Restricted: only the owner, members and admins can see this project.</p>}
          </div>
        </aside>
      </div>
    </>
  );
}
