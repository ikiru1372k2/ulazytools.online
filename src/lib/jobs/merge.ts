import { z } from "zod";

export const mergePdfOptionsSchema = z.object({
  pageOrder: z.array(z.number().int().nonnegative()).min(1),
});

export type MergePdfOptions = z.infer<typeof mergePdfOptionsSchema>;

export const createJobRequestSchema = z.object({
  inputFileIds: z
    .array(z.string().trim().min(1))
    .min(2, "Select at least two uploaded PDFs.")
    .max(20, "Merge supports up to 20 PDFs at a time.")
    .refine(
      (inputFileIds) => new Set(inputFileIds).size === inputFileIds.length,
      "Each uploaded PDF can only be included once."
    ),
  jobType: z.literal("pdf.merge"),
  options: mergePdfOptionsSchema,
});

export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;

export const createJobResponseSchema = z.object({
  jobId: z.string().trim().min(1),
  status: z.enum(["pending", "processing"]),
});

export type CreateJobResponse = z.infer<typeof createJobResponseSchema>;
