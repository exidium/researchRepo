import "server-only";
import { db } from "@/lib/db";
import { getProjectRole } from "@/lib/authz";
import type { User } from "@/generated/prisma/client";
import { highlightSelect } from "@/server/queries/highlights";

/** Source with segments, participants and the viewer's role; null when hidden. */
export async function getSourceForUser(user: User, sourceId: string) {
  const source = await db.source.findUnique({
    where: { id: sourceId },
    include: {
      project: { select: { id: true, name: true } },
      participants: { include: { participant: { select: { id: true, name: true, role: true, company: true, segment: true } } } },
      segments: { orderBy: { order: "asc" }, select: { id: true, order: true, speaker: true, participantId: true, startMs: true, endMs: true, text: true, version: true } },
      highlights: { orderBy: { createdAt: "asc" }, select: highlightSelect },
      _count: { select: { highlights: true } },
    },
  });
  if (!source) return null;
  const { role } = await getProjectRole(user, source.projectId);
  if (!role) return null;
  return { source, role };
}
