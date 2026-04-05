import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import SplitPdfPage from "@/app/(tools)/split/page";

jest.mock("@/components/upload/PresignedUploader", () => ({
  __esModule: true,
  default: function MockUploader(props: {
    onComplete?: (completed: Array<{
      etag: string;
      fileId: string;
      filename: string;
      objectKey: string;
    }>) => void;
  }) {
    return (
      <button
        onClick={() =>
          props.onComplete?.([
            {
              etag: "etag-1",
              fileId: "file-1",
              filename: "report.pdf",
              objectKey: "uploads/2026/04/guest/report.pdf",
            },
          ])
        }
        type="button"
      >
        Mock upload complete
      </button>
    );
  },
}));

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  });
}

describe("SplitPdfPage", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("keeps submit disabled until one PDF is uploaded and ranges are valid", () => {
    render(<SplitPdfPage />);

    const submit = screen.getByRole("button", { name: /start split job/i });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /mock upload complete/i }));
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/page ranges/i), {
      target: { value: "1-3,5" },
    });

    expect(submit).toBeEnabled();
  });

  it("shows inline validation for invalid ranges", async () => {
    render(<SplitPdfPage />);

    fireEvent.click(screen.getByRole("button", { name: /mock upload complete/i }));
    fireEvent.change(screen.getByLabelText(/page ranges/i), {
      target: { value: "3-1" },
    });
    fireEvent.blur(screen.getByLabelText(/page ranges/i));

    expect(
      await screen.findByText(/use page ranges like 1-3,5,8-10/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start split job/i })).toBeDisabled();
  });

  it("creates a job, polls progress, and only shows download when done", async () => {
    let statusCallCount = 0;

    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/jobs") {
        return jsonResponse(
          {
            jobId: "job-123",
            status: "pending",
          },
          201
        );
      }

      if (url === "/api/jobs/job-123") {
        statusCallCount += 1;
        const payload =
          statusCallCount === 1
            ? { status: "pending" }
            : statusCallCount === 2
              ? { status: "processing" }
              : {
                  downloadUrl: "https://example.com/download",
                  status: "done",
                };

        return jsonResponse(payload, 200);
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(<SplitPdfPage />);

    fireEvent.click(screen.getByRole("button", { name: /mock upload complete/i }));
    fireEvent.change(screen.getByLabelText(/page ranges/i), {
      target: { value: "1-3,5" },
    });
    fireEvent.click(screen.getByRole("button", { name: /start split job/i }));

    expect(await screen.findByText(/watching job-123/i)).toBeInTheDocument();
    expect(screen.getByText(/queued/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /download split pdf/i })
    ).not.toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(await screen.findByText(/processing/i)).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /download split pdf/i })
      ).toHaveAttribute("href", "https://example.com/download");
    });
  });

  it("surfaces failed job messaging", async () => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/jobs") {
        return jsonResponse(
          {
            jobId: "job-456",
            status: "pending",
          },
          201
        );
      }

      if (url === "/api/jobs/job-456") {
        return jsonResponse(
          {
            errorMessage: "The requested ranges could not be processed.",
            status: "failed",
          },
          200
        );
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(<SplitPdfPage />);

    fireEvent.click(screen.getByRole("button", { name: /mock upload complete/i }));
    fireEvent.change(screen.getByLabelText(/page ranges/i), {
      target: { value: "1-3,5" },
    });
    fireEvent.click(screen.getByRole("button", { name: /start split job/i }));

    expect(
      await screen.findByText(/the requested ranges could not be processed/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /download split pdf/i })
    ).not.toBeInTheDocument();
  });
});
