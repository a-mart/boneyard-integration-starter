import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadConfig } from "./config.js";
import { startServer } from "./server.js";

const DEV_DIR = ".dev";

function devSecret(name: string): string {
  const path = join(DEV_DIR, name);
  if (!existsSync(path)) writeFileSync(path, `${randomBytes(32).toString("base64url")}\n`, { mode: 0o600 });
  return path;
}

mkdirSync(DEV_DIR, { recursive: true, mode: 0o700 });
const env = {
  ...process.env,
  CONNECTION_TOKEN_FILE: process.env["CONNECTION_TOKEN_FILE"] ?? devSecret("connection-token"),
  BACKEND_API_KEY_FILE: process.env["BACKEND_API_KEY_FILE"] ?? devSecret("backend-api-key"),
};
const running = await startServer(loadConfig(env));
process.stdout.write(
  [
    "",
    `Example server (fake backend) listening at ${running.url}`,
    `Connection token file: ${env.CONNECTION_TOKEN_FILE}`,
    "Try it:   npm run kit:dev",
    `Check it: npm run kit -- check ${running.url} --token-file ${env.CONNECTION_TOKEN_FILE} --fake --canary-file ${env.BACKEND_API_KEY_FILE}`,
    "",
  ].join("\n"),
);
