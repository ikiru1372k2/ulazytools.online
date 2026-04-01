import "server-only";

export type UploadRateLimitIdentity = {
  guestId?: string;
  ip?: string;
  userId?: string;
};

export async function assertUploadPresignAllowed(
  _identity: UploadRateLimitIdentity
) {
  // Intentional no-op seam for future limiter enforcement.
}
