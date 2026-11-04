"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { AuthzError, projectIdOfSource, roleAtLeast } from "@/lib/authz";
import { projectAction } from "@/server/action";
import { CreateSourceSchema, DeleteSourceSchema, RequestTranscriptionSchema, SetSourceDurationSchema, UpdateSourceSchema } from "@/lib/validation/source";
import { enqueueTranscription } from "@/server/transcription";
import { removeSourceDir } from "@/lib/storage";

const refresh = () => revalidatePath("/", "layout");

export const createSource = projectAction(CreateSourceSchema, "EDITOR", (i) => i.projectId, async ({ projectId, title, date, participantIds }) => {
  const source = await db.source.create({
    data: {
      projectId, title, date,
      participants: { create: participantIds.map((participantId) => ({ participantId })) },
    },
    select: { id: true },
  });
  refresh();
  return source;
});

export const updateSource = projectAction(UpdateSourceSchema, "EDITOR", (i) => projectIdOfSource(i.id), async ({ id, participantIds, ...data }) => {
  await db.$transaction(async (tx) => {
    await tx.source.update({ where: { id }, data });
    if (participantIds) {
      await tx.sourceParticipant.deleteMany({ where: { sourceId: id, participantId: { notIn: participantIds } } });
      for (const participantId of participantIds) {
        await tx.sourceParticipant.upsert({
          where: { sourceId_participantId: { sourceId: id, participantId } },
          update: {},
          create: { sourceId: id, participantId },
        });
      }
    }
  });
  refresh();
  return { id };
});

/** Editors may delete a source that has no highlights; project admins may delete any source. */
export const deleteSource = projectAction(DeleteSourceSchema, "EDITOR", (i) => projectIdOfSource(i.id), async ({ id }, { role }) => {
  if (!roleAtLeast(role, "ADMIN")) {
    const n = await db.highlight.count({ where: { sourceId: id } });
    if (n > 0) throw new AuthzError("This source has highlights; only a project admin can delete it.");
  }
  await db.source.delete({ where: { id } });
  await removeSourceDir(id);
  refresh();
  return { id };
});

export const setSourceDuration = projectAction(SetSourceDurationSchema, "VIEWER", (i) => projectIdOfSource(i.id), async ({ id, durationMs }) => {
  await db.source.updateMany({ where: { id, durationMs: null }, data: { durationMs } });
  return { id };
});

export const requestTranscription = projectAction(RequestTranscriptionSchema, "EDITOR", (i) => projectIdOfSource(i.sourceId), async ({ sourceId, language }, { user }) => {
  const job = await enqueueTranscription(sourceId, user.id, { language });
  refresh();
  return job;
});
