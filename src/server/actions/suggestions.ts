"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { AuthzError, projectIdOfHighlight, projectIdOfSource } from "@/lib/authz";
import { projectAction } from "@/server/action";
import { idSchema } from "@/lib/validation/common";
import { locateQuote } from "@/lib/ai/quote";
import { highlightSelect } from "@/server/queries/highlights";
import { startHighlightJob, suggestTagsFor } from "@/server/suggestions";

async function projectIdOfSuggestion(suggestionId: string) {
  const s = await db.highlightSuggestion.findUnique({ where: { id: suggestionId }, select: { source: { select: { projectId: true } } } });
  if (!s) throw new AuthzError("Suggestion not found");
  return s.source.projectId;
}

const SourceInput = z.object({ sourceId: idSchema });
const SuggestionInput = z.object({ suggestionId: idSchema });
const AcceptInput = z.object({ suggestionId: idSchema, tagIds: z.array(idSchema).max(20) });
const HighlightInput = z.object({ highlightId: idSchema });
const TagInput = z.object({ highlightId: idSchema, tagId: idSchema });

/** "Suggest highlights": queue a proposal run for this transcript. */
export const requestHighlightSuggestions = projectAction(SourceInput, "EDITOR", (i) => projectIdOfSource(i.sourceId), async ({ sourceId }, { user }) => {
  return startHighlightJob(sourceId, user.id);
});

/**
 * Accept a proposal as a real highlight, with the tags the reviewer kept. The quote is found again in
 * the segment's current text, so edits since the run are respected; if it is gone, the proposal is
 * closed and the reviewer told.
 */
export const acceptHighlightSuggestion = projectAction(AcceptInput, "EDITOR", (i) => projectIdOfSuggestion(i.suggestionId), async ({ suggestionId, tagIds }, { user }) => {
  return db.$transaction(async (tx) => {
    const s = await tx.highlightSuggestion.findUniqueOrThrow({ where: { id: suggestionId }, select: { status: true, sourceId: true, segmentId: true, startOffset: true, quote: true, segment: { select: { text: true } } } });
    if (s.status !== "PENDING") throw new AuthzError("This suggestion was already reviewed.");
    const span = locateQuote(s.segment.text, s.quote, s.startOffset);
    if (!span) {
      await tx.highlightSuggestion.update({ where: { id: suggestionId }, data: { status: "REJECTED", reviewedById: user.id, reviewedAt: new Date() } });
      throw new AuthzError("The suggested text is no longer in the transcript.");
    }
    const active = await tx.tag.findMany({ where: { id: { in: tagIds }, archivedAt: null }, select: { id: true } });
    const highlight = await tx.highlight.create({
      data: {
        sourceId: s.sourceId, startSegmentId: s.segmentId, startOffset: span.start, endSegmentId: s.segmentId, endOffset: span.end,
        text: s.segment.text.slice(span.start, span.end), aiAssisted: true, createdById: user.id,
        tags: { create: active.map((t) => ({ tagId: t.id })) },
      },
      select: highlightSelect,
    });
    await tx.highlightSuggestion.update({ where: { id: suggestionId }, data: { status: "ACCEPTED", highlightId: highlight.id, reviewedById: user.id, reviewedAt: new Date() } });
    return { suggestionId, highlight };
  });
});

export const rejectHighlightSuggestion = projectAction(SuggestionInput, "EDITOR", (i) => projectIdOfSuggestion(i.suggestionId), async ({ suggestionId }, { user }) => {
  await db.highlightSuggestion.updateMany({ where: { id: suggestionId, status: "PENDING" }, data: { status: "REJECTED", reviewedById: user.id, reviewedAt: new Date() } });
  return { suggestionId };
});

export const rejectAllHighlightSuggestions = projectAction(SourceInput, "EDITOR", (i) => projectIdOfSource(i.sourceId), async ({ sourceId }, { user }) => {
  const r = await db.highlightSuggestion.updateMany({ where: { sourceId, status: "PENDING" }, data: { status: "REJECTED", reviewedById: user.id, reviewedAt: new Date() } });
  return { count: r.count };
});

/** "Suggest tags" on one highlight. Returns the highlight with its pending tag suggestions. */
export const requestTagSuggestions = projectAction(HighlightInput, "EDITOR", (i) => projectIdOfHighlight(i.highlightId), async ({ highlightId }) => {
  const added = await suggestTagsFor(highlightId);
  const highlight = await db.highlight.findUniqueOrThrow({ where: { id: highlightId }, select: highlightSelect });
  return { added, highlight };
});

export const acceptTagSuggestion = projectAction(TagInput, "EDITOR", (i) => projectIdOfHighlight(i.highlightId), async ({ highlightId, tagId }, { user }) => {
  const tag = await db.tag.findUnique({ where: { id: tagId }, select: { archivedAt: true } });
  if (!tag || tag.archivedAt) throw new AuthzError("That tag is archived.");
  await db.$transaction([
    db.highlightTag.createMany({ data: [{ highlightId, tagId }], skipDuplicates: true }),
    db.tagSuggestion.update({ where: { highlightId_tagId: { highlightId, tagId } }, data: { status: "ACCEPTED", reviewedById: user.id } }),
  ]);
  return db.highlight.findUniqueOrThrow({ where: { id: highlightId }, select: highlightSelect });
});

export const rejectTagSuggestion = projectAction(TagInput, "EDITOR", (i) => projectIdOfHighlight(i.highlightId), async ({ highlightId, tagId }, { user }) => {
  await db.tagSuggestion.updateMany({ where: { highlightId, tagId }, data: { status: "REJECTED", reviewedById: user.id } });
  return db.highlight.findUniqueOrThrow({ where: { id: highlightId }, select: highlightSelect });
});
