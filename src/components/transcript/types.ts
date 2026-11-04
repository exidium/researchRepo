import type { TagLike } from "@/lib/colors";

export type HighlightRow = {
  id: string; startSegmentId: string; startOffset: number; endSegmentId: string; endOffset: number;
  text: string; status: "ACTIVE" | "ORPHANED"; note: string | null; aiAssisted: boolean; createdAt: Date;
  createdBy: { id: string; name: string | null; email: string } | null;
  tags: { tag: TagLike & { archivedAt?: Date | null } }[];
  tagSuggestions: { reason: string | null; tag: TagLike }[];
};

export type ClientHighlight = Omit<HighlightRow, "tags" | "tagSuggestions"> & { tags: TagLike[]; suggestedTags: (TagLike & { reason: string | null })[] };

export const toClient = (h: HighlightRow): ClientHighlight => {
  const { tagSuggestions, ...rest } = h;
  return { ...rest, tags: h.tags.map((t) => t.tag), suggestedTags: tagSuggestions.map((s) => ({ ...s.tag, reason: s.reason })) };
};

/** A proposed highlight awaiting review; located in its segment by `quote`. */
export type ClientSuggestion = { id: string; segmentId: string; startOffset: number; endOffset: number; quote: string; reason: string | null; tags: TagLike[] };
