import "server-only";

import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";

import { PDFDocument } from "pdf-lib";

import { InternalAppError, NotFoundError, ValidationError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { buildObjectKey, buildObjectTags } from "@/lib/objectKey";
import {
  getObjectStream,
  StorageObjectNotFoundError,
  uploadBuffer,
} from "@/lib/storage";

type MergePdfInputFile = {
  fileId: string;
  objectKey: string;
};

type MergePdfOptions = {
  guestId?: string | null;
  inputFiles: MergePdfInputFile[];
  jobId: string;
  pageOrder: number[];
  requestId?: string;
  userId?: string | null;
};

export type MergePdfResult = {
  outputKey: string;
  userId: string | null;
};

function getOrderedInputs(
  inputFiles: MergePdfInputFile[],
  pageOrder: number[]
): MergePdfInputFile[] {
  return pageOrder.map((index) => {
    const inputFile = inputFiles[index];

    if (!inputFile) {
      throw new ValidationError("Merge request references a missing PDF input.", {
        code: "INVALID_PAGE_ORDER",
      });
    }

    return inputFile;
  });
}

function sanitizePdfFailureMessage(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "One of the PDFs could not be read.";
  }

  return normalized.length > 220 ? normalized.slice(0, 220) : normalized;
}

function toMergePdfError(error: unknown) {
  if (error instanceof StorageObjectNotFoundError) {
    return new NotFoundError("One of the PDFs could not be found in storage.", {
      code: "PDF_INPUT_NOT_FOUND",
    });
  }

  if (error instanceof ValidationError || error instanceof NotFoundError) {
    return error;
  }

  if (error instanceof Error) {
    const normalizedMessage = error.message.toLowerCase();

    if (normalizedMessage.includes("encrypted")) {
      return new ValidationError(
        "One of the PDFs is encrypted and cannot be merged.",
        {
          code: "PDF_ENCRYPTED",
        }
      );
    }

    if (
      normalizedMessage.includes("pdf") ||
      normalizedMessage.includes("trailer") ||
      normalizedMessage.includes("xref") ||
      normalizedMessage.includes("invalid object")
    ) {
      return new ValidationError(
        `One of the PDFs could not be read: ${sanitizePdfFailureMessage(error.message)}`,
        {
          code: "PDF_CORRUPT",
        }
      );
    }
  }

  return new InternalAppError("Unable to merge PDF files", {
    code: "PDF_MERGE_FAILED",
  });
}

async function toBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (
    body &&
    typeof body === "object" &&
    "transformToByteArray" in body &&
    typeof body.transformToByteArray === "function"
  ) {
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];

    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  throw new Error("Storage response body is not readable");
}

export async function mergePdf(
  options: MergePdfOptions
): Promise<MergePdfResult> {
  const log = createLogger({
    jobId: options.jobId,
    requestId: options.requestId,
    userId: options.userId ?? undefined,
  });
  const tempDir = await mkdtemp(join(tmpdir(), "ulazytools-merge-"));

  try {
    const orderedInputs = getOrderedInputs(options.inputFiles, options.pageOrder);
    const mergedPdf = await PDFDocument.create();

    for (const [index, inputFile] of orderedInputs.entries()) {
      const object = await getObjectStream(inputFile.objectKey);
      const bytes = await toBuffer(object.body);
      const tempInputPath = join(tempDir, `${index + 1}-${inputFile.fileId}.pdf`);

      await writeFile(tempInputPath, bytes);

      const sourcePdf = await PDFDocument.load(Uint8Array.from(bytes), {
        ignoreEncryption: false,
      });
      const copiedPages = await mergedPdf.copyPages(
        sourcePdf,
        sourcePdf.getPageIndices()
      );

      copiedPages.forEach((page) => {
        mergedPdf.addPage(page);
      });
    }

    const outputBytes = Buffer.from(await mergedPdf.save());
    const outputPath = join(tempDir, "merged.pdf");

    await writeFile(outputPath, outputBytes);

    const outputKey = buildObjectKey({
      filename: "merged.pdf",
      guestId: options.guestId,
      jobId: options.jobId,
      kind: "output",
      userId: options.userId,
    });

    await uploadBuffer(outputKey, await readFile(outputPath), "application/pdf", {
      tags: buildObjectTags({
        jobId: options.jobId,
      }),
    });

    log.info(
      {
        inputCount: orderedInputs.length,
        outputKey,
      },
      "Merged PDF inputs successfully"
    );

    return {
      outputKey,
      userId: options.userId ?? null,
    };
  } catch (error) {
    throw toMergePdfError(error);
  } finally {
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
}
