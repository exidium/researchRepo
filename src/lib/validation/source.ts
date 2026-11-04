import { z } from "zod";
import { dateInput, idSchema } from "./common";

export const CreateSourceSchema = z.object({
  projectId: idSchema,
  title: z.string().trim().min(1, "Title is required").max(300),
  date: dateInput,
  participantIds: z.array(idSchema).max(50).default([]),
});

export const UpdateSourceSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(300).optional(),
  date: dateInput.optional(),
  participantIds: z.array(idSchema).max(50).optional(),
});

export const DeleteSourceSchema = z.object({ id: idSchema });

export const SetSourceDurationSchema = z.object({ id: idSchema, durationMs: z.number().int().positive().max(24 * 3600 * 1000) });

export const RequestTranscriptionSchema = z.object({ sourceId: idSchema, language: z.string().regex(/^[a-z]{2}$/).nullable().optional() });
