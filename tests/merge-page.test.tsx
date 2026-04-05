import { act, fireEvent, render, screen } from "@testing-library/react";

import MergePage from "@/app/(tools)/merge/page";
import type { UploadItem } from "@/lib/upload/s3Put";

const mockStartPresignedUploads = jest.fn();
const mockCreateJob = jest.fn();
const mockUseJobPoll = jest.fn();

jest.mock("@/lib/upload/s3Put", () => ({
  startPresignedUploads: (...args: unknown[]) => mockStartPresignedUploads(...args),
}));

jest.mock("@/lib/api/client", () => ({
  createJob: (...args: unknown[]) => mockCreateJob(...args),
}));

jest.mock("@/hooks/useJobPoll", () => ({
  useJobPoll: (...args: unknown[]) => mockUseJobPoll(...args),
}));

function createFile(name: string) {
  return new File(["pdf"], name, {
    lastModified: 500,
    type: "application/pdf",
  });
}

describe("MergePage", () => {
  beforeEach(() => {
    mockStartPresignedUploads.mockReset();
    mockCreateJob.mockReset();
    mockUseJobPoll.mockReset();
    mockUseJobPoll.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      isPaused: false,
      isPolling: false,
    });
  });

  it("keeps submit disabled until at least two uploads are ready", () => {
    render(<MergePage />);

    expect(screen.getByRole("button", { name: /start merge/i })).toBeDisabled();
  });

  it("rejects non-pdf selection before any upload starts", () => {
    render(<MergePage />);

    fireEvent.change(screen.getByLabelText(/select pdfs/i), {
      target: {
        files: [
          new File(["text"], "notes.txt", {
            lastModified: 501,
            type: "text/plain",
          }),
        ],
      },
    });

    expect(mockStartPresignedUploads).not.toHaveBeenCalled();
    expect(screen.getByText(/only pdf files can be uploaded/i)).toBeInTheDocument();
  });

  it("starts a merge job after successful uploads", async () => {
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
            filename: "first.pdf",
            objectKey: "uploads/first.pdf",
          },
          {
            etag: "etag-2",
            fileId: "file-2",
            filename: "second.pdf",
            objectKey: "uploads/second.pdf",
          },
        ]),
      };
    });
    mockCreateJob.mockResolvedValue({
      jobId: "job-123",
      status: "pending",
    });

    render(<MergePage />);

    fireEvent.change(screen.getByLabelText(/select pdfs/i), {
      target: {
        files: [createFile("first.pdf"), createFile("second.pdf")],
      },
    });

    await act(async () => {
      runtime?.onBatchComplete?.([
        {
          etag: "etag-1",
          fileId: "file-1",
          filename: "first.pdf",
          objectKey: "uploads/first.pdf",
        },
        {
          etag: "etag-2",
          fileId: "file-2",
          filename: "second.pdf",
          objectKey: "uploads/second.pdf",
        },
      ]);
    });

    fireEvent.click(screen.getByRole("button", { name: /start merge/i }));

    expect(mockCreateJob).toHaveBeenCalledWith({
      inputFileIds: ["file-1", "file-2"],
      jobType: "pdf.merge",
      options: {
        pageOrder: [0, 1],
      },
    }, {
      idempotencyKey: expect.any(String),
    });
  });

  it("shows the backend failure text for failed jobs", () => {
    mockUseJobPoll.mockReturnValue({
      data: {
        errorCode: "MERGE_FAILED",
        lastError: "Source PDF is corrupted.",
        status: "failed",
      },
      error: null,
      isLoading: false,
      isPaused: false,
      isPolling: false,
    });

    render(<MergePage />);

    expect(screen.getByText(/source pdf is corrupted/i)).toBeInTheDocument();
  });

  it("shows the download action only for completed jobs", () => {
    mockUseJobPoll.mockReturnValue({
      data: {
        downloadUrl: "https://example.com/download",
        status: "done",
      },
      error: null,
      isLoading: false,
      isPaused: false,
      isPolling: false,
    });

    render(<MergePage />);

    expect(screen.getByRole("link", { name: /download merged pdf/i })).toHaveAttribute(
      "href",
      "https://example.com/download"
    );
  });

  it("keeps merge submission disabled while a job is already in progress", async () => {
    let runtime:
      | {
          onBatchComplete?: (completed: Array<{ etag: string; fileId: string; filename: string; objectKey: string }>) => void;
        }
      | undefined;

    mockStartPresignedUploads.mockImplementation((files, nextRuntime) => {
      runtime = nextRuntime;

      return {
        cancel: jest.fn(),
        promise: Promise.resolve([]),
      };
    });
    mockUseJobPoll.mockReturnValue({
      data: {
        status: "pending",
      },
      error: null,
      isLoading: false,
      isPaused: false,
      isPolling: true,
    });

    render(<MergePage />);

    fireEvent.change(screen.getByLabelText(/select pdfs/i), {
      target: {
        files: [createFile("first.pdf"), createFile("second.pdf")],
      },
    });

    await act(async () => {
      runtime?.onBatchComplete?.([
        {
          etag: "etag-1",
          fileId: "file-1",
          filename: "first.pdf",
          objectKey: "uploads/first.pdf",
        },
        {
          etag: "etag-2",
          fileId: "file-2",
          filename: "second.pdf",
          objectKey: "uploads/second.pdf",
        },
      ]);
    });

    expect(screen.getByRole("button", { name: /merge in progress/i })).toBeDisabled();
  });
});
