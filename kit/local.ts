import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { runChecks } from "./check.js";
import { loadFixtures } from "./fixtures.js";
import { formatReport, passed } from "./report.js";
import { createTarget, readSecretFile } from "./target.js";

export const LocalConfigSchema = z
  .object({
    command: z.array(z.string().min(1)).min(1),
    env: z.record(z.string(), z.string()).default({}),
    url: z.string().min(1),
    canaryFiles: z.array(z.string().min(1)).default([]),
    fixtures: z.string().min(1).optional(),
    trustsCallerContext: z.boolean().default(false),
    startupTimeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
  })
  .strict();

export type LocalConfig = z.infer<typeof LocalConfigSchema>;

export function loadLocalConfig(path: string): LocalConfig {
  const parsed = LocalConfigSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`Kit config ${path} is invalid: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export interface Placeholders {
  readonly port: number;
  readonly dir: string;
}

const PLACEHOLDER = /\{(port|token_file|random_file:[a-z0-9_-]{1,40})\}/gu;

function randomFile(dir: string, name: string): string {
  const path = join(dir, name);
  try {
    writeFileSync(path, randomBytes(24).toString("base64url"), { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  return path;
}

export function expand(value: string, places: Placeholders): string {
  return value.replace(PLACEHOLDER, (_match, key: string) => {
    if (key === "port") return String(places.port);
    if (key === "token_file") return randomFile(places.dir, "connection-token");
    return randomFile(places.dir, key.slice("random_file:".length));
  });
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("Could not find a free port.");
  return address.port;
}

async function waitForServer(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`The server exited with code ${child.exitCode} before it answered.`);
    const answered = await fetch(url, { method: "POST", body: "{}", signal: AbortSignal.timeout(1000) }).then(
      () => true,
      () => false,
    );
    if (answered) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`The server did not answer at ${url} within ${timeoutMs} ms.`);
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timer);
}

export async function runLocalCheck(config: LocalConfig, write: (text: string) => void): Promise<boolean> {
  const dir = mkdtempSync(join(tmpdir(), "kit-local-"));
  const places: Placeholders = { port: await freePort(), dir };
  const env = Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, expand(value, places)]));
  const [command = "", ...args] = config.command.map((part) => expand(part, places));
  const output: string[] = [];
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));
  let ok = false;
  try {
    const url = expand(config.url, places);
    await waitForServer(url, child, config.startupTimeoutMs);
    const token = readSecretFile(expand("{token_file}", places), "Token");
    const target = createTarget({ url, token, authHeader: "Authorization", extraHeaders: {} });
    const canaries = config.canaryFiles.map((path) => readSecretFile(expand(path, places), "Canary"));
    const fixtures = loadFixtures(config.fixtures);
    ok = true;
    for (const fake of [false, true]) {
      const report = await runChecks(target, { fake, canaries, fixtures, trustsCallerContext: config.trustsCallerContext });
      write(`${formatReport(report)}\n\n`);
      ok &&= passed(report);
    }
  } finally {
    await stop(child);
    rmSync(dir, { recursive: true, force: true });
    if (!ok) write(`Server output:\n${output.join("") || "(none)"}\n`);
  }
  return ok;
}
