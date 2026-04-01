describe("guest identity", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("reuses an existing guest ID", async () => {
    const { resolveGuestIdentity } = await import(
      "@/server/uploads/guestIdentity"
    );

    expect(resolveGuestIdentity("guest-123")).toEqual({
      guestId: "guest-123",
      isNew: false,
    });
  });

  it("generates a new guest ID when one does not exist", async () => {
    const { resolveGuestIdentity } = await import(
      "@/server/uploads/guestIdentity"
    );

    const identity = resolveGuestIdentity(undefined);

    expect(identity.isNew).toBe(true);
    expect(identity.guestId).toBeTruthy();
  });
});
