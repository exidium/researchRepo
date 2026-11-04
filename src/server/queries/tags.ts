import "server-only";
import { db } from "@/lib/db";
import { visibleProjectsWhere } from "@/lib/authz";
import { Prisma, type User } from "@/generated/prisma/client";

export const tagSelect = { id: true, name: true, color: true, archivedAt: true, group: { select: { id: true, name: true, color: true } } } as const;

/** Active tags for pickers, grouped order then name. */
export async function listTagsForPicker() {
  return db.tag.findMany({ where: { archivedAt: null }, orderBy: [{ group: { position: "asc" } }, { name: "asc" }], select: tagSelect });
}

/** Everything the admin tag manager needs: groups in order, tags with usage counts, including archived. */
export async function listTagsAdmin() {
  const [groups, tags] = await Promise.all([
    db.tagGroup.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }] }),
    db.tag.findMany({ orderBy: { name: "asc" }, select: { ...tagSelect, description: true, externalIds: true, _count: { select: { highlights: true } } } }),
  ]);
  return { groups, tags };
}

// ---------- usage counts ----------


function accessSql(user: User) {
  return user.isAdmin
    ? Prisma.sql`TRUE`
    : Prisma.sql`(p."access" = 'OPEN' OR p."ownerId" = ${user.id} OR EXISTS (SELECT 1 FROM "ProjectMember" pm WHERE pm."projectId" = p."id" AND pm."userId" = ${user.id}))`;
}

/** Active highlights per (tag, project) for the projects the user can see. */
export async function tagProjectCounts(user: User, projectId?: string) {
  const rows = await db.$queryRaw<{ tagId: string; projectId: string; n: bigint }[]>`
    SELECT ht."tagId", p."id" AS "projectId", count(*) AS n
    FROM "HighlightTag" ht
    JOIN "Highlight" h ON h."id" = ht."highlightId"
    JOIN "Source" s ON s."id" = h."sourceId"
    JOIN "Project" p ON p."id" = s."projectId"
    WHERE h."status" = 'ACTIVE' AND ${accessSql(user)} ${projectId ? Prisma.sql`AND p."id" = ${projectId}` : Prisma.empty}
    GROUP BY 1, 2`;
  return rows.map((r) => ({ tagId: r.tagId, projectId: r.projectId, count: Number(r.n) }));
}

/** Everything the tags-by-project table needs. */
export async function tagMatrix(user: User) {
  const [counts, projects, tags, groups] = await Promise.all([
    tagProjectCounts(user),
    db.project.findMany({ where: { AND: [visibleProjectsWhere(user), { archivedAt: null }] }, orderBy: [{ startDate: "asc" }, { name: "asc" }], select: { id: true, name: true, productArea: true } }),
    db.tag.findMany({ where: { archivedAt: null }, select: tagSelect, orderBy: { name: "asc" } }),
    db.tagGroup.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, name: true, color: true } }),
  ]);
  return { counts, projects, tags, groups };
}
