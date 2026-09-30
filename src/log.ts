import type { LogLevel } from "./config.js";

export type LogValue = string | number | boolean | null;
export type LogFields = Readonly<Record<string, LogValue>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly secrets: readonly string[];
  readonly write?: (line: string) => void;
}

const RANK: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /token|secret|password|authorization|cookie|api[-_]?key|credential/iu;
const REDACTED = "[redacted]";

function redactValue(value: LogValue, secrets: readonly string[]): LogValue {
  if (typeof value !== "string") return value;
  return secrets.some((secret) => value.includes(secret)) ? REDACTED : value;
}

export function redactFields(fields: LogFields, secrets: readonly string[]): LogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, SENSITIVE_KEY.test(key) ? REDACTED : redactValue(value, secrets)]),
  );
}

export function createLogger(options: LoggerOptions): Logger {
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const secrets = options.secrets.filter((secret) => secret.length > 0);
  const emit = (level: LogLevel) => (event: string, fields: LogFields = {}) => {
    if (RANK[level] < RANK[options.level]) return;
    write(JSON.stringify({ time: new Date().toISOString(), level, event, ...redactFields(fields, secrets) }));
  };
  return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error") };
}
