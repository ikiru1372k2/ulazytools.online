export const REQUEST_ID_HEADER = "x-request-id";

export function normalizeRequestId(value: string | null | undefined) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function getOrCreateRequestId(value: string | null | undefined) {
  return normalizeRequestId(value) ?? crypto.randomUUID();
}
