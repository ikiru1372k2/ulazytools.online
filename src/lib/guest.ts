import { getGuestEnv } from "@/lib/env";

export const GUEST_ID_COOKIE = "guestId";
export const INTERNAL_GUEST_ID_HEADER = "x-ulazytools-guest-id";
export const INTERNAL_GUEST_ID_TRUST_HEADER = "x-ulazytools-guest-trusted";
const GUEST_ID_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const guestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type GuestSession = {
  guestId: string;
  isNew: boolean;
  shouldSetCookie: boolean;
};

function toHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(value: string) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    return null;
  }

  const bytes = new Uint8Array(value.length / 2);

  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }

  return bytes;
}

function getCryptoApi() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.randomUUID) {
    throw new Error("Web Crypto API is unavailable");
  }

  return globalThis.crypto;
}

export function isGuestId(value: string) {
  return guestIdPattern.test(value);
}

let signingKeyPromise: Promise<CryptoKey> | undefined;

async function getSigningKey() {
  signingKeyPromise ??= getCryptoApi().subtle.importKey(
    "raw",
    new TextEncoder().encode(getGuestEnv().GUEST_COOKIE_SECRET),
    {
      hash: "SHA-256",
      name: "HMAC",
    },
    false,
    ["sign", "verify"]
  );

  return signingKeyPromise;
}

export async function serializeGuestCookie(guestId: string) {
  if (!isGuestId(guestId)) {
    throw new Error("Guest ID must be a UUID v4");
  }

  const cryptoApi = getCryptoApi();
  const signingKey = await getSigningKey();
  const payload = new TextEncoder().encode(guestId);
  const signature = await cryptoApi.subtle.sign("HMAC", signingKey, payload);

  return `${guestId}.${toHex(new Uint8Array(signature))}`;
}

export async function verifyGuestCookieValue(
  signedGuestCookieValue?: string | null
) {
  const normalizedValue = signedGuestCookieValue?.trim();

  if (!normalizedValue) {
    return null;
  }

  const [guestId, signature] = normalizedValue.split(".");

  if (!guestId || !signature) {
    return null;
  }

  if (!isGuestId(guestId)) {
    return null;
  }

  const signatureBytes = fromHex(signature);

  if (!signatureBytes) {
    return null;
  }

  const signingKey = await getSigningKey();
  const cryptoApi = getCryptoApi();
  const payload = new TextEncoder().encode(guestId);
  const isValid = await cryptoApi.subtle.verify(
    "HMAC",
    signingKey,
    signatureBytes,
    payload
  );

  if (!isValid) {
    return null;
  }

  return guestId;
}

export async function resolveGuestSession(
  signedGuestCookieValue?: string | null
): Promise<GuestSession> {
  const verifiedGuestId = await verifyGuestCookieValue(signedGuestCookieValue);

  if (verifiedGuestId) {
    return {
      guestId: verifiedGuestId,
      isNew: false,
      shouldSetCookie: false,
    };
  }

  return {
    guestId: getCryptoApi().randomUUID(),
    isNew: true,
    shouldSetCookie: true,
  };
}

export function getGuestCookieOptions() {
  return {
    httpOnly: true,
    maxAge: GUEST_ID_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
