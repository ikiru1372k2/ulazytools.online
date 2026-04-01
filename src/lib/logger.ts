import pino from "pino";

const isDevelopment = process.env.NODE_ENV !== "production";

export const LOGGER_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "body.password",
  "body.token",
  "body.accessToken",
  "body.refreshToken",
  "*.password",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "presignedUrl",
] as const;

export type LoggerBindings = {
  jobId?: string;
  queue?: string;
  requestId?: string;
  userId?: string | null;
};

export const logger = pino({
  level: isDevelopment ? "debug" : "info",
  transport: isDevelopment
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
        },
      }
    : undefined,
  redact: {
    paths: [...LOGGER_REDACT_PATHS],
    remove: true,
  },
});

export function createLogger(bindings: LoggerBindings = {}) {
  return logger.child(bindings);
}
