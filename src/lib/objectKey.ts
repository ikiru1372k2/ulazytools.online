export type BuildObjectKeyInput = {
  date?: Date;
  filename: string;
  guestId?: string | null;
  jobId: string;
  kind: "output" | "upload";
  tenant?: string | null;
  userId?: string | null;
};

export type BuildObjectTagsInput = {
  expiresAt?: Date | null;
  jobId?: string | null;
};

function normalizeUnicode(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function sanitizeSegment(value: string, fallback?: string) {
  const normalized = normalizeUnicode(value).trim().toLowerCase();
  const safe = normalized
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (safe) {
    return safe;
  }

  if (fallback) {
    return fallback;
  }

  throw new Error("Object key segment must contain at least one safe character");
}

function sanitizeFilename(filename: string) {
  const normalized = normalizeUnicode(filename).trim().toLowerCase();

  if (!normalized) {
    return "payload.bin";
  }

  const lastDot = normalized.lastIndexOf(".");
  const basename = lastDot > 0 ? normalized.slice(0, lastDot) : normalized;
  const extension = lastDot > 0 ? normalized.slice(lastDot + 1) : "";
  const safeBasename = sanitizeSegment(basename, "payload");
  const safeExtension = extension
    ? sanitizeSegment(extension).replace(/^\.+/, "")
    : "";

  return safeExtension ? `${safeBasename}.${safeExtension}` : safeBasename;
}

function getMonth(date: Date) {
  return String(date.getUTCMonth() + 1).padStart(2, "0");
}

function getActorSegments(input: Pick<BuildObjectKeyInput, "guestId" | "userId">) {
  if (input.userId) {
    return ["users", sanitizeSegment(input.userId)];
  }

  if (input.guestId) {
    return ["guests", sanitizeSegment(input.guestId)];
  }

  return ["anonymous"];
}

export function buildObjectKey(input: BuildObjectKeyInput) {
  const jobId = sanitizeSegment(input.jobId);
  const filename = sanitizeFilename(input.filename);

  if (input.kind === "output") {
    const parts = ["outputs"];

    if (input.tenant) {
      parts.push("tenants", sanitizeSegment(input.tenant));
    }

    parts.push(jobId, filename);

    return parts.join("/");
  }

  const date = input.date ?? new Date();
  const parts = [
    "uploads",
    String(date.getUTCFullYear()),
    getMonth(date),
  ];

  if (input.tenant) {
    parts.push("tenants", sanitizeSegment(input.tenant));
  }
  parts.push(...getActorSegments(input), "jobs", jobId, filename);

  return parts.join("/");
}

export function buildObjectTags(input: BuildObjectTagsInput = {}) {
  const tags: Record<string, string> = {
    app: "ulazytoolsa",
  };

  if (input.jobId) {
    tags.jobId = input.jobId.trim();
  }

  if (input.expiresAt) {
    tags.expiresAt = input.expiresAt.toISOString();
  }

  return tags;
}
