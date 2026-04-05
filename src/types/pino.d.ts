declare module "pino" {
  type Logger = {
    child: (bindings?: Record<string, unknown>) => Logger;
    debug: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };

  type LoggerOptions = {
    level?: string;
    redact?: {
      paths: readonly string[];
      remove?: boolean;
    };
    transport?: {
      options?: Record<string, unknown>;
      target: string;
    };
  };

  export default function pino(options?: LoggerOptions): Logger;
}
