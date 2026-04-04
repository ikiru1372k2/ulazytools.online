describe("object key helpers", () => {
  it("generates a stable upload key for the same input", async () => {
    const { buildObjectKey } = await import("@/lib/objectKey");
    const date = new Date("2026-04-04T12:00:00.000Z");

    const first = buildObjectKey({
      date,
      filename: "Report Final.pdf",
      jobId: "job-123",
      kind: "upload",
      userId: "User_123",
    });
    const second = buildObjectKey({
      date,
      filename: "Report Final.pdf",
      jobId: "job-123",
      kind: "upload",
      userId: "User_123",
    });

    expect(first).toBe(second);
    expect(first).toBe(
      "uploads/2026/04/users/user_123/jobs/job-123/report-final.pdf"
    );
  });

  it("ensures different jobs never share the same output prefix", async () => {
    const { buildObjectKey } = await import("@/lib/objectKey");

    const first = buildObjectKey({
      filename: "processed.pdf",
      jobId: "job-123",
      kind: "output",
      userId: "user-123",
    });
    const second = buildObjectKey({
      filename: "processed.pdf",
      jobId: "job-456",
      kind: "output",
      userId: "user-123",
    });

    expect(first.split("/").slice(0, -1).join("/")).not.toBe(
      second.split("/").slice(0, -1).join("/")
    );
  });

  it("normalizes unicode filenames into safe slugs", async () => {
    const { buildObjectKey } = await import("@/lib/objectKey");

    const key = buildObjectKey({
      date: new Date("2026-04-04T12:00:00.000Z"),
      filename: "Résumé Üpload 你好.pdf",
      guestId: "00000000-0000-4000-8000-000000000123",
      jobId: "job-123",
      kind: "upload",
    });

    expect(key).toBe(
      "uploads/2026/04/guests/00000000-0000-4000-8000-000000000123/jobs/job-123/resume-upload.pdf"
    );
  });

  it("preserves the legacy output key shape while using the shared helper", async () => {
    const { buildObjectKey } = await import("@/lib/objectKey");

    const key = buildObjectKey({
      filename: "processed.pdf",
      guestId: "guest-123",
      jobId: "job-123",
      kind: "output",
      userId: null,
    });

    expect(key).toBe("outputs/job-123/processed.pdf");
  });

  it("keeps guest and user key spaces distinct", async () => {
    const { buildObjectKey } = await import("@/lib/objectKey");
    const date = new Date("2026-04-04T12:00:00.000Z");

    const userKey = buildObjectKey({
      date,
      filename: "file.pdf",
      jobId: "job-123",
      kind: "upload",
      userId: "user-123",
    });
    const guestKey = buildObjectKey({
      date,
      filename: "file.pdf",
      guestId: "guest-123",
      jobId: "job-123",
      kind: "upload",
    });

    expect(userKey).toContain("/users/user-123/");
    expect(guestKey).toContain("/guests/guest-123/");
  });

  it("builds lifecycle tags with app, jobId, and expiresAt", async () => {
    const { buildObjectTags } = await import("@/lib/objectKey");
    const expiresAt = new Date("2026-04-11T12:00:00.000Z");

    expect(
      buildObjectTags({
        expiresAt,
        jobId: "job-123",
      })
    ).toEqual({
      app: "ulazytoolsa",
      expiresAt: "2026-04-11T12:00:00.000Z",
      jobId: "job-123",
    });
  });
});
