import { tagSelect } from "@/server/queries/tags";

/** Shape returned to the editor for every highlight mutation and read. */
export const highlightSelect = {
  id: true, sourceId: true, startSegmentId: true, startOffset: true, endSegmentId: true, endOffset: true, text: true, status: true, note: true, aiAssisted: true, createdAt: true,
  createdBy: { select: { id: true, name: true, email: true } },
  tags: { select: { tag: { select: tagSelect } } },
  tagSuggestions: { where: { status: "PENDING" as const, tag: { archivedAt: null } }, orderBy: { createdAt: "asc" as const }, select: { reason: true, tag: { select: tagSelect } } },
} as const;
