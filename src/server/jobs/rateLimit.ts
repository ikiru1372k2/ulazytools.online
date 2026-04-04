import "server-only";

export type JobStatusRateLimitIdentity = {
  guestId?: string;
  ip?: string;
  userId?: string;
};

export async function assertJobStatusAllowed(
  _identity: JobStatusRateLimitIdentity
) {
  // Intentional no-op seam for future limiter enforcement.
}
