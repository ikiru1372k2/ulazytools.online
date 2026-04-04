import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { useJobPoll } from "@/hooks/useJobPoll";

type MockResponse = {
  body: Record<string, unknown>;
  ok?: boolean;
  status?: number;
};

function createJsonResponse({
  body,
  ok = true,
  status = 200,
}: MockResponse) {
  return {
    json: async () => body,
    ok,
    status,
  };
}

function HookHarness() {
  const [jobId, setJobId] = useState<string | null>("job-123");
  const { cancel, data, error, isLoading, isPaused, isPolling, restart } =
    useJobPoll(jobId);

  return (
    <div>
      <button onClick={cancel} type="button">
        Cancel
      </button>
      <button onClick={restart} type="button">
        Restart
      </button>
      <button onClick={() => setJobId(null)} type="button">
        Clear job
      </button>
      <div data-testid="loading">{String(isLoading)}</div>
      <div data-testid="paused">{String(isPaused)}</div>
      <div data-testid="polling">{String(isPolling)}</div>
      <div data-testid="status">{data?.status ?? "none"}</div>
      <div data-testid="error">{error ?? "none"}</div>
      <div data-testid="downloadUrl">
        {data && "downloadUrl" in data ? data.downloadUrl : "none"}
      </div>
    </div>
  );
}

describe("useJobPoll", () => {
  const originalHidden = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
  let hiddenValue = false;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    hiddenValue = false;
    fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;

    Object.defineProperty(document, "hidden", {
      configurable: true,
      get() {
        return hiddenValue;
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();

    if (originalHidden) {
      Object.defineProperty(document, "hidden", originalHidden);
    }
  });

  it("starts polling immediately and backs off until a terminal state", async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({ body: { status: "pending" } }) as never
      )
      .mockResolvedValueOnce(
        createJsonResponse({ body: { status: "processing" } }) as never
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          body: {
            downloadUrl: "https://example.com/download",
            status: "done",
          },
        }) as never
      );

    render(<HookHarness />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("status")).toHaveTextContent("pending");

    await act(async () => {
      jest.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("status")).toHaveTextContent("processing");

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("status")).toHaveTextContent("done");
    expect(screen.getByTestId("polling")).toHaveTextContent("false");
    expect(screen.getByTestId("downloadUrl")).toHaveTextContent(
      "https://example.com/download"
    );

    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses capped exponential backoff for repeated non-terminal responses", async () => {
    fetchMock.mockImplementation(
      async () => createJsonResponse({ body: { status: "processing" } }) as never
    );

    render(<HookHarness />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await act(async () => {
      jest.advanceTimersByTime(4000);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);

    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("pauses when hidden and resumes immediately when visible again", async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({ body: { status: "processing" } }) as never
      )
      .mockResolvedValueOnce(
        createJsonResponse({ body: { status: "processing" } }) as never
      );

    render(<HookHarness />);

    await act(async () => {
      await Promise.resolve();
    });

    hiddenValue = true;

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(screen.getByTestId("paused")).toHaveTextContent("true");
    expect(screen.getByTestId("polling")).toHaveTextContent("false");

    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    hiddenValue = false;

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(screen.getByTestId("paused")).toHaveTextContent("false");
    expect(screen.getByTestId("polling")).toHaveTextContent("true");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancel stops timers and in-flight polling", async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse({ body: { status: "processing" } }) as never
    );

    render(<HookHarness />);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("polling")).toHaveTextContent("false");
    expect(screen.getByTestId("status")).toHaveTextContent("none");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("restart resets polling after cancel", async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({ body: { status: "processing" } }) as never
      )
      .mockResolvedValueOnce(
        createJsonResponse({ body: { status: "processing" } }) as never
      );

    render(<HookHarness />);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    fireEvent.click(screen.getByRole("button", { name: /restart/i }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("polling")).toHaveTextContent("true");
  });

  it("surfaces API errors and stops polling", async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse({
        body: { error: "JOB_EXPIRED" },
        ok: false,
        status: 410,
      }) as never
    );

    render(<HookHarness />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("error")).toHaveTextContent("JOB_EXPIRED");
    expect(screen.getByTestId("polling")).toHaveTextContent("false");
  });

  it("retries transient failures with backoff instead of stopping permanently", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("Network down"))
      .mockResolvedValueOnce(
        createJsonResponse({ body: { status: "processing" } }) as never
      );

    render(<HookHarness />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("error")).toHaveTextContent("Network down");
    expect(screen.getByTestId("polling")).toHaveTextContent("true");

    await act(async () => {
      jest.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("status")).toHaveTextContent("processing");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("cleans up in-flight polling on unmount", async () => {
    let resolveFetch: ((value: unknown) => void) | null = null;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const { unmount } = render(<HookHarness />);

    await act(async () => {
      await Promise.resolve();
    });

    unmount();

    await act(async () => {
      resolveFetch?.(
        createJsonResponse({ body: { status: "processing" } }) as never
      );
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not start when the jobId becomes empty", async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse({ body: { status: "processing" } }) as never
    );

    render(<HookHarness />);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /clear job/i }));

    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("status")).toHaveTextContent("none");
  });
});
