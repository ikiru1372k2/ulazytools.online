import { z } from "zod";

export const mergePdfOptionsSchema = z.object({
  includeBookmarks: z.boolean().default(false),
  outputFilename: z
    .string()
    .trim()
    .min(1, "Enter an output filename or leave it blank.")
    .max(120, "Use 120 characters or fewer.")
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/,
      "Use letters, numbers, spaces, dots, underscores, or hyphens."
    )
    .optional(),
});

export type MergePdfOptions = z.infer<typeof mergePdfOptionsSchema>;

export const createJobRequestSchema = z.object({
  inputKeys: z
    .array(z.string().trim().min(1))
    .min(2, "Select at least two uploaded PDFs.")
    .max(20, "Merge supports up to 20 PDFs at a time.")
    .refine(
      (inputKeys) => new Set(inputKeys).size === inputKeys.length,
      "Each uploaded PDF can only be included once."
    ),
  jobType: z.literal("merge"),
  options: mergePdfOptionsSchema,
});

export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;

export const createJobResponseSchema = z.object({
  jobId: z.string().trim().min(1),
  status: z.enum(["pending", "processing"]),
});

export type CreateJobResponse = z.infer<typeof createJobResponseSchema>;
