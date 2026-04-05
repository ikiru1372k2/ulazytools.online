import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import PresignedUploader from "@/components/upload/PresignedUploader";
import type { UploadItem } from "@/lib/upload/s3Put";

const mockStartPresignedUploads = jest.fn();

jest.mock("@/lib/upload/s3Put", () => ({
  startPresignedUploads: (...args: unknown[]) => mockStartPresignedUploads(...args),
}));

function createFile(name: string) {
  return new File(["pdf"], name, {
    lastModified: 500,
    type: "application/pdf",
  });
}

describe("PresignedUploader", () => {
  beforeEach(() => {
    mockStartPresignedUploads.mockReset();
  });

  it("renders progress updates and a success summary for selected PDFs", async () => {
    const file = createFile("report.pdf");
    let runtime:
      | {
          onBatchComplete?: (completed: Array<{ etag: string; fileId: string; filename: string; objectKey: string }>) => void;
          onItemUpdate?: (item: UploadItem) => void;
        }
      | undefined;

    mockStartPresignedUploads.mockImplementation((files, nextRuntime) => {
      runtime = nextRuntime;

      return {
        cancel: jest.fn(),
        promise: Promise.resolve([
          {
            etag: "etag-1",
            fileId: "file-1",
            filename: "report.pdf",
            objectKey: "uploads/2026/04/report.pdf",
          },
        ]),
      };
    });

    render(<PresignedUploader />);

    fireEvent.change(screen.getByLabelText(/select pdfs/i), {
      target: { files: [file] },
    });

    await act(async () => {
      runtime?.onItemUpdate?.({
        file,
        localId: "local-1",
        progress: 42,
        status: "uploading",
      });
    });

    expect(await screen.findByText(/uploading 42%/i)).toBeInTheDocument();

    await act(async () => {
      runtime?.onItemUpdate?.({
        etag: "etag-1",
        file,
        fileId: "file-1",
        localId: "local-1",
        progress: 100,
        status: "success",
      });
      runtime?.onBatchComplete?.([
        {
          etag: "etag-1",
          fileId: "file-1",
          filename: "report.pdf",
          objectKey: "uploads/2026/04/report.pdf",
        },
      ]);
    });

    expect(await screen.findByText(/uploaded 1 file successfully/i)).toBeInTheDocument();
    expect(
      screen.getByRole("status", {
        name: "",
      })
    ).toBeInTheDocument();
  });

  it("shows cancel only for active items and forwards the cancel call", async () => {
    const file = createFile("cancelable.pdf");
    const cancel = jest.fn();
    let runtime:
      | {
          onItemUpdate?: (item: UploadItem) => void;
        }
      | undefined;

    mockStartPresignedUploads.mockImplementation((files, nextRuntime) => {
      runtime = nextRuntime;

      return {
        cancel,
        promise: new Promise(() => {}),
      };
    });

    render(<PresignedUploader />);

    fireEvent.change(screen.getByLabelText(/select pdfs/i), {
      target: { files: [file] },
    });

    await act(async () => {
      runtime?.onItemUpdate?.({
        file,
        localId: "local-cancel",
        progress: 5,
        status: "presigning",
      });
    });

    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));
    expect(cancel).toHaveBeenCalledWith("local-cancel");

    await act(async () => {
      runtime?.onItemUpdate?.({
        file,
        localId: "local-cancel",
        progress: 5,
        status: "error",
        error: "Upload failed",
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    });
    expect(screen.getByText(/upload failed/i)).toBeInTheDocument();
  });

  it("rejects non-pdf-only selections before starting an upload batch", () => {
    const file = new File(["text"], "notes.txt", {
      lastModified: 600,
      type: "text/plain",
    });

    render(<PresignedUploader />);

    fireEvent.change(screen.getByLabelText(/select pdfs/i), {
      target: { files: [file] },
    });

    expect(mockStartPresignedUploads).not.toHaveBeenCalled();
    expect(screen.getByText(/only pdf files can be uploaded/i)).toBeInTheDocument();
  });

  it("accepts a pdf filename even when the browser omits the mime type", () => {
    const file = new File(["pdf"], "mobile-export.pdf", {
      lastModified: 602,
      type: "",
    });

    mockStartPresignedUploads.mockImplementation(() => ({
      cancel: jest.fn(),
      promise: Promise.resolve([]),
    }));

    render(<PresignedUploader />);

    fireEvent.change(screen.getByLabelText(/select pdfs/i), {
      target: { files: [file] },
    });

    expect(mockStartPresignedUploads).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText(/only pdf files can be uploaded/i)
    ).not.toBeInTheDocument();
  });

  it("rejects mixed selections instead of partially uploading them", () => {
    const validFile = createFile("valid.pdf");
    const invalidFile = new File(["text"], "notes.txt", {
      lastModified: 601,
      type: "text/plain",
    });

    render(<PresignedUploader />);

    fireEvent.change(screen.getByLabelText(/select pdfs/i), {
      target: { files: [validFile, invalidFile] },
    });

    expect(mockStartPresignedUploads).not.toHaveBeenCalled();
    expect(screen.getByText(/only pdf files can be uploaded/i)).toBeInTheDocument();
  });

  it("rejects multiple files when configured for single-file mode", () => {
    const firstFile = createFile("first.pdf");
    const secondFile = createFile("second.pdf");

    render(<PresignedUploader allowMultiple={false} />);

    fireEvent.change(screen.getByLabelText(/select pdf/i), {
      target: { files: [firstFile, secondFile] },
    });

    expect(mockStartPresignedUploads).not.toHaveBeenCalled();
    expect(
      screen.getByText(/choose a single pdf file to continue/i)
    ).toBeInTheDocument();
  });

  it("cancels tracked uploads on unmount", async () => {
    const file = createFile("cleanup.pdf");
    const cancel = jest.fn();
    let runtime:
      | {
          onItemUpdate?: (item: UploadItem) => void;
        }
      | undefined;

    mockStartPresignedUploads.mockImplementation((files, nextRuntime) => {
      runtime = nextRuntime;

      return {
        cancel,
        promise: new Promise(() => {}),
      };
    });

    const { unmount } = render(<PresignedUploader />);

    fireEvent.change(screen.getByLabelText(/select pdfs/i), {
      target: { files: [file] },
    });

    await act(async () => {
      runtime?.onItemUpdate?.({
        file,
        localId: "local-cleanup",
        progress: 0,
        status: "presigning",
      });
    });

    unmount();

    expect(cancel).toHaveBeenCalledWith("local-cleanup");
  });
});
