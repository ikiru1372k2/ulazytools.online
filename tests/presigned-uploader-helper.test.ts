import {
  startPresignedUploads,
  type UploadItem,
} from "@/lib/upload/s3Put";

type MockXhrBehavior = {
  etag?: string;
  onSend?: (xhr: MockXhr) => void;
};

class MockXhr {
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  readyState = 4;
  responseText = "";
  status = 0;
  upload = {
    onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null,
  };

  private behavior: MockXhrBehavior;

  constructor(behavior: MockXhrBehavior) {
    this.behavior = behavior;
  }

  abort() {
    this.onabort?.();
  }

  getResponseHeader(name: string) {
    if (name.toLowerCase() === "etag") {
      return this.behavior.etag ?? null;
    }

    return null;
  }

  open() {}

  send() {
    this.behavior.onSend?.(this);
  }

  setRequestHeader() {}
}

function jsonResponse(body: unknown, status = 200) {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  };
}

describe("startPresignedUploads", () => {
  it("uploads successfully, reports progress, and normalizes etag before complete", async () => {
    const file = new File(["pdf"], "report.pdf", {
      lastModified: 100,
      type: "application/pdf",
    });
    const updates: UploadItem[] = [];
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          fileId: "file-123",
          headers: {
            "content-type": "application/pdf",
          },
          uploadUrl: "https://example.test/upload",
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const controller = startPresignedUploads([file], {
      fetchImpl: fetchImpl as typeof fetch,
      onItemUpdate: (item) => updates.push(item),
      sleep: async () => {},
      xhrFactory: () =>
        new MockXhr({
          etag: '"etag-123"',
          onSend(xhr) {
            xhr.upload.onprogress?.({
              lengthComputable: true,
              loaded: 25,
              total: 100,
            });
            xhr.upload.onprogress?.({
              lengthComputable: true,
              loaded: 100,
              total: 100,
            });
            xhr.status = 200;
            xhr.onload?.();
          },
        }) as never,
    });

    await expect(controller.promise).resolves.toEqual([
      {
        etag: "etag-123",
        fileId: "file-123",
        filename: "report.pdf",
      },
    ]);

    expect(updates.map((item) => item.status)).toEqual([
      "queued",
      "presigning",
      "uploading",
      "uploading",
      "uploading",
      "uploading",
      "completing",
      "success",
    ]);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/upload/complete",
      expect.objectContaining({
        body: JSON.stringify({
          etag: "etag-123",
          fileId: "file-123",
        }),
      })
    );
  });

  it("retries complete once when the server marks the verification error as retryable", async () => {
    const file = new File(["pdf"], "retry.pdf", {
      lastModified: 200,
      type: "application/pdf",
    });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          fileId: "file-retry",
          headers: {},
          uploadUrl: "https://example.test/upload",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "UPLOAD_NOT_VISIBLE_YET",
              message: "Upload is not visible yet",
            },
            retryable: true,
          },
          409
        )
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const controller = startPresignedUploads([file], {
      fetchImpl: fetchImpl as typeof fetch,
      sleep: async () => {},
      xhrFactory: () =>
        new MockXhr({
          etag: '"etag-retry"',
          onSend(xhr) {
            xhr.status = 200;
            xhr.onload?.();
          },
        }) as never,
    });

    await controller.promise;

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/upload/complete",
      expect.any(Object)
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "/api/upload/complete",
      expect.any(Object)
    );
  });

  it("cancels an in-flight PUT and never calls complete", async () => {
    const file = new File(["pdf"], "cancel.pdf", {
      lastModified: 300,
      type: "application/pdf",
    });
    const updates: UploadItem[] = [];
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse({
        fileId: "file-cancel",
        headers: {},
        uploadUrl: "https://example.test/upload",
      })
    );

    let activeXhr: MockXhr | null = null;

    const controller = startPresignedUploads([file], {
      fetchImpl: fetchImpl as typeof fetch,
      onItemUpdate: (item) => updates.push(item),
      sleep: async () => {},
      xhrFactory: () =>
        new MockXhr({
          etag: '"etag-cancel"',
          onSend(xhr) {
            activeXhr = xhr;
          },
        }) as never,
    });

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    controller.cancel(updates[0].localId);
    expect(activeXhr).not.toBeNull();

    await expect(controller.promise).resolves.toEqual([]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(updates.at(-1)?.status).toBe("canceled");
  });

  it("cancels during presigning and never starts the PUT request", async () => {
    const file = new File(["pdf"], "presign-cancel.pdf", {
      lastModified: 301,
      type: "application/pdf",
    });
    const updates: UploadItem[] = [];
    const presignDeferred: {
      promise: Promise<{ json: () => Promise<unknown>; ok: boolean; status: number }>;
      resolve: (value: {
        json: () => Promise<unknown>;
        ok: boolean;
        status: number;
      }) => void;
    } = {
      promise: Promise.resolve({ json: async () => ({}), ok: true, status: 200 }),
      resolve: () => {},
    };

    presignDeferred.promise = new Promise((resolve) => {
      presignDeferred.resolve = resolve;
    });

    const fetchImpl = jest.fn().mockImplementation(() => presignDeferred.promise);
    const xhrFactory = jest.fn();

    const controller = startPresignedUploads([file], {
      fetchImpl: fetchImpl as typeof fetch,
      onItemUpdate: (item) => updates.push(item),
      sleep: async () => {},
      xhrFactory: xhrFactory as never,
    });

    await Promise.resolve();

    controller.cancel(updates[0].localId);
    presignDeferred.resolve(
      jsonResponse({
        fileId: "file-presign-cancel",
        headers: {},
        uploadUrl: "https://example.test/upload",
      })
    );

    await expect(controller.promise).resolves.toEqual([]);
    expect(xhrFactory).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(updates.at(-1)?.status).toBe("canceled");
  });

  it("uploads multiple files sequentially", async () => {
    const first = new File(["a"], "first.pdf", {
      lastModified: 10,
      type: "application/pdf",
    });
    const second = new File(["b"], "second.pdf", {
      lastModified: 11,
      type: "application/pdf",
    });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          fileId: "file-1",
          headers: {},
          uploadUrl: "https://example.test/upload-1",
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          fileId: "file-2",
          headers: {},
          uploadUrl: "https://example.test/upload-2",
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const xhrQueue = [
      new MockXhr({
        etag: '"etag-1"',
        onSend(xhr) {
          xhr.status = 200;
          xhr.onload?.();
        },
      }),
      new MockXhr({
        etag: '"etag-2"',
        onSend(xhr) {
          xhr.status = 200;
          xhr.onload?.();
        },
      }),
    ];

    const controller = startPresignedUploads([first, second], {
      fetchImpl: fetchImpl as typeof fetch,
      sleep: async () => {},
      xhrFactory: () => xhrQueue.shift() as never,
    });

    await expect(controller.promise).resolves.toEqual([
      {
        etag: "etag-1",
        fileId: "file-1",
        filename: "first.pdf",
      },
      {
        etag: "etag-2",
        fileId: "file-2",
        filename: "second.pdf",
      },
    ]);

    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "/api/upload/presign",
      "/api/upload/complete",
      "/api/upload/presign",
      "/api/upload/complete",
    ]);
  });
});
