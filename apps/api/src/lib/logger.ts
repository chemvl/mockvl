import pino from "pino";
import { env } from "@/config/env";

// Field names whose values must never reach the log stream: credential-ish
// headers, passwords, and anything ending in KEY/SECRET/TOKEN in snake_case,
// kebab-case or camelCase form.
const EXACT_SENSITIVE_KEYS = /^(authorization|cookie|set-cookie|password)$/i;
const SUFFIXED_SENSITIVE_KEYS = /[_-](key|secret|token)$/i;
const CAMEL_SENSITIVE_KEYS = /[a-z](Key|Secret|Token)$/;
const MAX_REDACTION_DEPTH = 8;

function isSensitiveKey(key: string): boolean {
  return (
    EXACT_SENSITIVE_KEYS.test(key) ||
    SUFFIXED_SENSITIVE_KEYS.test(key) ||
    CAMEL_SENSITIVE_KEYS.test(key)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > MAX_REDACTION_DEPTH) return "[MaxDepth]";
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, depth + 1));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) =>
        isSensitiveKey(key) ? [key, "[Redacted]"] : [key, redactSecrets(item, depth + 1)],
      ),
    );
  }
  return value;
}

export interface CreateLoggerOptions {
  level?: pino.LevelWithSilent;
  destination?: pino.DestinationStream;
}

export function createLogger(options: CreateLoggerOptions = {}): pino.Logger {
  const { level = env.LOG_LEVEL, destination } = options;
  const loggerOptions: pino.LoggerOptions = {
    level,
    // pino's default err serializer copies every own property of an Error
    // (including AppError.details) into the log line AFTER formatters run,
    // so redaction must be applied to the serializer's output here.
    serializers: {
      // The serialized error carries a custom prototype, which redactSecrets
      // deliberately skips — spread it into a plain object first.
      err: (err: Error) => redactSecrets({ ...pino.stdSerializers.err(err) }),
    },
    formatters: {
      log: (entry) => redactSecrets(entry) as Record<string, unknown>,
    },
  };
  return destination ? pino(loggerOptions, destination) : pino(loggerOptions);
}

export const logger: pino.Logger = createLogger();

export type Logger = typeof logger;
