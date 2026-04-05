import { readFileSync } from "fs";

const getObjectStream = jest.fn();
const uploadBuffer = jest.fn();
const loggerInfo = jest.fn();
const rm = jest.fn();
const tempFiles = new Map<string, Buffer>();

jest.mock("fs/promises", () => ({
  ...jest.requireActual("fs/promises"),
  mkdtemp: jest.fn(async () => "C:\\temp\\ulazytools-merge-test"),
  readFile: jest.fn(async (path: string) => {
    const normalizedPath = String(path);

    if (tempFiles.has(normalizedPath)) {
      return tempFiles.get(normalizedPath);
    }

    return jest.requireActual("fs/promises").readFile(path);
  }),
  rm: (...args: unknown[]) => rm(...args),
  writeFile: jest.fn(async (path: string, data: Buffer | Uint8Array | string) => {
    tempFiles.set(
      String(path),
      Buffer.isBuffer(data) ? data : Buffer.from(data)
    );
  }),
}));

jest.mock("@/lib/storage", () => ({
  getObjectStream: (...args: unknown[]) => getObjectStream(...args),
  StorageObjectNotFoundError: class StorageObjectNotFoundError extends Error {},
  uploadBuffer: (...args: unknown[]) => uploadBuffer(...args),
}));

jest.mock("@/lib/logger", () => ({
  createLogger: jest.fn(() => ({
    info: loggerInfo,
  })),
}));

describe("mergePdf", () => {
  beforeEach(() => {
    jest.resetModules();
    getObjectStream.mockReset();
    uploadBuffer.mockReset();
    loggerInfo.mockReset();
    rm.mockReset();
    tempFiles.clear();
  });

  it("merges fixture PDFs in the requested order and uploads to outputs/{jobId}/", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const firstFixture = readFileSync("src/server/pdf/__fixtures__/one-page.pdf");
    const secondFixture = readFileSync("src/server/pdf/__fixtures__/two-page.pdf");
    let uploadedBytes: Buffer | null = null;

    getObjectStream
      .mockResolvedValueOnce({ body: firstFixture })
      .mockResolvedValueOnce({ body: secondFixture });
    uploadBuffer.mockImplementation(async (_key, body: Buffer) => {
      uploadedBytes = body;
      return {
        bucket: "test-bucket",
        contentType: "application/pdf",
        key: "outputs/job-merge/merged.pdf",
        size: body.length,
      };
    });

    const { mergePdf } = await import("@/server/pdf/mergePdf");

    const result = await mergePdf({
      inputFiles: [
        { fileId: "file-1", objectKey: "uploads/file-1.pdf" },
        { fileId: "file-2", objectKey: "uploads/file-2.pdf" },
      ],
      jobId: "job-merge",
      pageOrder: [1, 0],
      userId: "user-123",
    });

    expect(result).toEqual({
      outputKey: "outputs/job-merge/merged.pdf",
      userId: "user-123",
    });
    expect(uploadBuffer).toHaveBeenCalledWith(
      "outputs/job-merge/merged.pdf",
      expect.any(Buffer),
      "application/pdf",
      expect.any(Object)
    );
    expect(uploadedBytes).not.toBeNull();
    const mergedPdf = await PDFDocument.load(Uint8Array.from(uploadedBytes!));
    expect(mergedPdf.getPageCount()).toBe(3);
  });

  it("cleans up the temp directory in finally", async () => {
    const fixture = readFileSync("src/server/pdf/__fixtures__/one-page.pdf");

    getObjectStream
      .mockResolvedValueOnce({ body: fixture })
      .mockResolvedValueOnce({ body: fixture });
    uploadBuffer.mockResolvedValue({
      bucket: "test-bucket",
      contentType: "application/pdf",
      key: "outputs/job-merge/merged.pdf",
      size: 100,
    });

    const { mergePdf } = await import("@/server/pdf/mergePdf");

    await mergePdf({
      inputFiles: [
        { fileId: "file-1", objectKey: "uploads/file-1.pdf" },
        { fileId: "file-2", objectKey: "uploads/file-2.pdf" },
      ],
      jobId: "job-merge-clean",
      pageOrder: [0, 1],
      userId: "user-123",
    });

    expect(rm).toHaveBeenCalledWith("C:\\temp\\ulazytools-merge-test", {
      force: true,
      recursive: true,
    });
  });

  it("returns a safe encrypted-pdf error", async () => {
    getObjectStream.mockResolvedValue({
      body: Buffer.from("encrypted pdf"),
    });

    const pdfLib = await import("pdf-lib");
    const loadSpy = jest
      .spyOn(pdfLib.PDFDocument, "load")
      .mockRejectedValueOnce(
        new Error("Input document to PDFDocument.load is encrypted.")
      );

    const { mergePdf } = await import("@/server/pdf/mergePdf");

    await expect(
      mergePdf({
        inputFiles: [
          { fileId: "file-1", objectKey: "uploads/file-1.pdf" },
          { fileId: "file-2", objectKey: "uploads/file-2.pdf" },
        ],
        jobId: "job-merge",
        pageOrder: [0, 1],
      })
    ).rejects.toMatchObject({
      code: "PDF_ENCRYPTED",
      userMessage: "One of the PDFs is encrypted and cannot be merged.",
    });

    loadSpy.mockRestore();
  });

  it("returns a safe corrupt-pdf error", async () => {
    getObjectStream.mockResolvedValue({
      body: Buffer.from("%PDF-1.4\ncorrupt"),
    });
    const pdfLib = await import("pdf-lib");
    const loadSpy = jest
      .spyOn(pdfLib.PDFDocument, "load")
      .mockRejectedValueOnce(new Error("Failed to parse PDF trailer"));

    const { mergePdf } = await import("@/server/pdf/mergePdf");

    await expect(
      mergePdf({
        inputFiles: [
          { fileId: "file-1", objectKey: "uploads/file-1.pdf" },
          { fileId: "file-2", objectKey: "uploads/file-2.pdf" },
        ],
        jobId: "job-merge",
        pageOrder: [0, 1],
      })
    ).rejects.toMatchObject({
      code: "PDF_CORRUPT",
    });

    loadSpy.mockRestore();
  });

  it("maps missing storage objects to PDF_INPUT_NOT_FOUND", async () => {
    const { StorageObjectNotFoundError } = await import("@/lib/storage");

    getObjectStream.mockRejectedValue(
      new StorageObjectNotFoundError("uploads/missing.pdf")
    );

    const { mergePdf } = await import("@/server/pdf/mergePdf");

    await expect(
      mergePdf({
        inputFiles: [
          { fileId: "file-1", objectKey: "uploads/file-1.pdf" },
          { fileId: "file-2", objectKey: "uploads/file-2.pdf" },
        ],
        jobId: "job-merge",
        pageOrder: [0, 1],
      })
    ).rejects.toMatchObject({
      code: "PDF_INPUT_NOT_FOUND",
      userMessage: "One of the PDFs could not be found in storage.",
    });
  });

  it("maps non-pdf infrastructure failures to PDF_MERGE_FAILED", async () => {
    getObjectStream
      .mockResolvedValueOnce({
        body: readFileSync("src/server/pdf/__fixtures__/one-page.pdf"),
      })
      .mockResolvedValueOnce({
        body: readFileSync("src/server/pdf/__fixtures__/one-page.pdf"),
      });
    uploadBuffer.mockRejectedValue(new Error("disk full"));

    const { mergePdf } = await import("@/server/pdf/mergePdf");

    await expect(
      mergePdf({
        inputFiles: [
          { fileId: "file-1", objectKey: "uploads/file-1.pdf" },
          { fileId: "file-2", objectKey: "uploads/file-2.pdf" },
        ],
        jobId: "job-merge",
        pageOrder: [0, 1],
      })
    ).rejects.toMatchObject({
      code: "PDF_MERGE_FAILED",
      userMessage: "Unable to merge PDF files",
    });
  });
});
