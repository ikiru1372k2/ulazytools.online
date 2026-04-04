export type AppErrorLogContext = Record<string, unknown>;

type AppErrorConfig = {
  cause?: unknown;
  code: string;
  httpStatus: number;
  logContext?: AppErrorLogContext;
  userMessage: string;
};

type AppErrorOverride = Partial<
  Pick<AppError, "code" | "httpStatus" | "logContext" | "userMessage">
>;

export class AppError extends Error {
  code: string;
  httpStatus: number;
  logContext?: AppErrorLogContext;
  userMessage: string;

  constructor(config: AppErrorConfig) {
    super(config.userMessage, config.cause ? { cause: config.cause } : undefined);
    this.name = "AppError";
    this.code = config.code;
    this.httpStatus = config.httpStatus;
    this.logContext = config.logContext;
    this.userMessage = config.userMessage;
  }
}

export class NotFoundError extends AppError {
  constructor(userMessage = "Not found", override?: AppErrorOverride) {
    super({
      code: override?.code ?? "NOT_FOUND",
      httpStatus: override?.httpStatus ?? 404,
      logContext: override?.logContext,
      userMessage: override?.userMessage ?? userMessage,
    });
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(userMessage: string, override?: AppErrorOverride) {
    super({
      code: override?.code ?? "VALIDATION_ERROR",
      httpStatus: override?.httpStatus ?? 400,
      logContext: override?.logContext,
      userMessage: override?.userMessage ?? userMessage,
    });
    this.name = "ValidationError";
  }
}

export class ConflictError extends AppError {
  constructor(userMessage: string, override?: AppErrorOverride) {
    super({
      code: override?.code ?? "CONFLICT",
      httpStatus: override?.httpStatus ?? 409,
      logContext: override?.logContext,
      userMessage: override?.userMessage ?? userMessage,
    });
    this.name = "ConflictError";
  }
}

export class GoneError extends AppError {
  constructor(userMessage: string, override?: AppErrorOverride) {
    super({
      code: override?.code ?? "GONE",
      httpStatus: override?.httpStatus ?? 410,
      logContext: override?.logContext,
      userMessage: override?.userMessage ?? userMessage,
    });
    this.name = "GoneError";
  }
}

export class InternalAppError extends AppError {
  constructor(userMessage = "An unexpected error occurred", override?: AppErrorOverride) {
    super({
      code: override?.code ?? "INTERNAL_ERROR",
      httpStatus: override?.httpStatus ?? 500,
      logContext: override?.logContext,
      userMessage: override?.userMessage ?? userMessage,
    });
    this.name = "InternalAppError";
  }
}

export class RateLimitError extends AppError {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, override?: AppErrorOverride) {
    super({
      code: override?.code ?? "RATE_LIMITED",
      httpStatus: override?.httpStatus ?? 429,
      logContext: override?.logContext,
      userMessage:
        override?.userMessage ?? "Too many requests. Please try again later.",
    });
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isAppError(error: unknown): error is AppError {
  if (error instanceof AppError) {
    return true;
  }

  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      "httpStatus" in error &&
      "userMessage" in error &&
      typeof (error as Record<string, unknown>).code === "string" &&
      typeof (error as Record<string, unknown>).httpStatus === "number" &&
      typeof (error as Record<string, unknown>).userMessage === "string"
  );
}

export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  return new InternalAppError();
}
