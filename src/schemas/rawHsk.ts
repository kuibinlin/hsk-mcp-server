import { z } from "zod";

export const RawTranscriptionsSchema = z.object({
  pinyin: z.string().min(1),
  numeric: z.string().min(1),
  wadegiles: z.string().min(1),
  bopomofo: z.string().min(1),
  romatzyh: z.string().min(1),
});

export const RawFormSchema = z.object({
  traditional: z.string().min(1),
  transcriptions: RawTranscriptionsSchema,
  meanings: z.array(z.string()),
  classifiers: z.array(z.string()),
});

export const RawHskLevelSchema = z.enum([
  "new-1",
  "new-2",
  "new-3",
  "new-4",
  "new-5",
  "new-6",
  "new-7",
  "old-1",
  "old-2",
  "old-3",
  "old-4",
  "old-5",
  "old-6",
]);

export const RawHskEntrySchema = z.object({
  simplified: z.string().min(1),
  radical: z.string().min(1),
  level: z.array(RawHskLevelSchema).min(1),
  frequency: z.number().int().nonnegative(),
  pos: z.array(z.string()),
  forms: z.array(RawFormSchema).min(1),
});

export const RawHskDatasetSchema = z.array(RawHskEntrySchema);

export type RawTranscriptions = z.infer<typeof RawTranscriptionsSchema>;
export type RawForm = z.infer<typeof RawFormSchema>;
export type RawHskLevel = z.infer<typeof RawHskLevelSchema>;
export type RawHskEntry = z.infer<typeof RawHskEntrySchema>;
export type RawHskDataset = z.infer<typeof RawHskDatasetSchema>;
