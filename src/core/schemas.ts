import * as z from "zod";

export const readFormatSchema = z.enum(["table", "json", "md"]);

export const readOptionsSchema = z.object({
  format: readFormatSchema,
  raw: z.boolean(),
  thumbnail: z.boolean(),
  out: z.string().min(1).optional(),
});

export type ReadOptions = z.infer<typeof readOptionsSchema>;

export const inputsSchema = z.array(z.string().min(1)).min(1, "Provide at least one file or glob.");

export const outputOptionsSchema = z.object({
  out: z.string().min(1).optional(),
  outFile: z.string().min(1).optional(),
  inPlace: z.boolean(),
});

export const writeOptionsSchema = outputOptionsSchema.extend({
  set: z.array(z.string().min(1)),
  fromJson: z.string().min(1).optional(),
  copyFrom: z.string().min(1).optional(),
});

export const copyrightOptionsSchema = outputOptionsSchema.extend({
  owner: z.string().min(1).optional(),
  notice: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  usageTerms: z.string().min(1).optional(),
  sync: z.boolean(),
});

export const gpsOptionsSchema = outputOptionsSchema.extend({
  set: z.string().min(1).optional(),
  remove: z.boolean(),
});

export const datesOptionsSchema = outputOptionsSchema.extend({
  set: z.string().min(1).optional(),
  shift: z.string().min(1).optional(),
  tags: z.string().min(1).optional(),
});

export const stripModeSchema = z.enum(["all", "privacy", "gps", "custom"]);

export const stripOptionsSchema = outputOptionsSchema.extend({
  mode: stripModeSchema,
  tags: z.array(z.string().min(1)),
  keep: z.array(z.string().min(1)),
  verify: z.boolean(),
  reencode: z.boolean(),
  yes: z.boolean(),
  zip: z.boolean(),
});

export const hashOptionsSchema = z.object({
  compare: z.string().min(1).optional(),
});

export const scanOptionsSchema = z.object({
  depth: z.number().int().min(0).max(20).optional(),
  ext: z.string().min(1).optional(),
  followSymlinks: z.boolean(),
  noHash: z.boolean(),
  concurrency: z.number().int().min(1).max(32).optional(),
  out: z.string().min(1).optional(),
  format: z.string().min(1),
});

export const snapshotDirSchema = z.object({
  snapshotDir: z.string().min(1).optional(),
});

export const batchStripOptionsSchema = outputOptionsSchema.extend({
  mode: stripModeSchema,
  tags: z.array(z.string().min(1)),
  keep: z.array(z.string().min(1)),
  verify: z.boolean(),
  reencode: z.boolean(),
  yes: z.boolean(),
  dryRun: z.boolean(),
  concurrency: z.number().int().min(1).max(32).optional(),
  ext: z.string().min(1).optional(),
  zip: z.boolean(),
});

export const batchWriteOptionsSchema = outputOptionsSchema.extend({
  set: z.array(z.string().min(1)),
  dryRun: z.boolean(),
  concurrency: z.number().int().min(1).max(32).optional(),
  ext: z.string().min(1).optional(),
});

export const watchOptionsSchema = z.object({
  depth: z.number().int().min(0).max(20).optional(),
  ext: z.string().min(1).optional(),
  followSymlinks: z.boolean(),
  noHash: z.boolean(),
  concurrency: z.number().int().min(1).max(32).optional(),
  debounceMs: z.number().int().min(50).max(10000).optional(),
  out: z.string().min(1).optional(),
  format: z.string().min(1),
});
