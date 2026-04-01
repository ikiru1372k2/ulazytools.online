import "server-only";

import { randomUUID } from "crypto";

export const GUEST_ID_COOKIE = "guestId";
const GUEST_ID_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type GuestIdentity = {
  guestId: string;
  isNew: boolean;
};

export function resolveGuestIdentity(existingGuestId?: string | null): GuestIdentity {
  const normalizedGuestId = existingGuestId?.trim();

  if (normalizedGuestId) {
    return {
      guestId: normalizedGuestId,
      isNew: false,
    };
  }

  return {
    guestId: randomUUID(),
    isNew: true,
  };
}

export function getGuestCookieOptions() {
  return {
    httpOnly: true,
    maxAge: GUEST_ID_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax" as const,
  };
}
