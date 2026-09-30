import { readFileSync } from "node:fs";

import { z } from "zod";

const flag = z.enum(["true", "false"]).default("false").transform((value) => value === "true");

const commaList = z
  .string()
  .default("")
  .transform((value) => value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0));

const EnvSchema = z.object({
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(0).max(65_535).default(8750),
  MCP_PATH: z.string().regex(/^\/[A-Za-z0-9/_-]*$/u).default("/mcp"),
  CONNECTION_TOKEN: z.string().optional(),
  CONNECTION_TOKEN_FILE: z.string().min(1).optional(),
  TRUST_CALLER_CONTEXT: flag,
  BACKEND: z.enum(["fake"]).default("fake"),
  BACKEND_API_KEY: z.string().optional(),
  BACKEND_API_KEY_FILE: z.string().min(1).optional(),
  MAX_RESULT_BYTES: z.coerce.number().int().min(1024).max(262_144).default(65_536),
  MAX_BODY_BYTES: z.coerce.number().int().min(1024).max(4_194_304).default(1_048_576),
  ALLOWED_ORIGINS: commaList,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type LogLevel = z.infer<typeof EnvSchema>["LOG_LEVEL"];

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly mcpPath: string;
  readonly connectionToken: string;
  readonly trustCallerContext: boolean;
  readonly backend: { readonly kind: "fake"; readonly apiKey: string };
  readonly maxResultBytes: number;
  readonly maxBodyBytes: number;
  readonly allowedOrigins: readonly string[];
  readonly logLevel: LogLevel;
}

export type ReadFile = (path: string) => string;

const readUtf8: ReadFile = (path) => readFileSync(path, "utf8");

export function readSecret(name: string, inline: string | undefined, file: string | undefined, minLength: number, read: ReadFile): string {
  if (inline !== undefined && file !== undefined) throw new Error(`Set ${name} or ${name}_FILE, not both.`);
  const value = (file === undefined ? inline : read(file))?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${name} or ${name}_FILE is required.`);
  if (value.length < minLength) throw new Error(`${name} must be at least ${minLength} characters.`);
  if (/\s/u.test(value)) throw new Error(`${name} must not contain whitespace.`);
  return value;
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>, read: ReadFile = readUtf8): ServerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid configuration: ${z.prettifyError(parsed.error)}`);
  const values = parsed.data;
  return Object.freeze({
    host: values.HOST,
    port: values.PORT,
    mcpPath: values.MCP_PATH,
    connectionToken: readSecret("CONNECTION_TOKEN", values.CONNECTION_TOKEN, values.CONNECTION_TOKEN_FILE, 32, read),
    trustCallerContext: values.TRUST_CALLER_CONTEXT,
    backend: { kind: values.BACKEND, apiKey: readSecret("BACKEND_API_KEY", values.BACKEND_API_KEY, values.BACKEND_API_KEY_FILE, 16, read) },
    maxResultBytes: values.MAX_RESULT_BYTES,
    maxBodyBytes: values.MAX_BODY_BYTES,
    allowedOrigins: values.ALLOWED_ORIGINS,
    logLevel: values.LOG_LEVEL,
  });
}
