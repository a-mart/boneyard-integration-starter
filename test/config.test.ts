import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig } from "../src/config.js";

const token = "t".repeat(40);
const key = "k".repeat(20);

test("config reads secrets from files and applies defaults", () => {
  const files: Record<string, string> = { "/run/token": `${token}\n`, "/run/key": key };
  const config = loadConfig({ CONNECTION_TOKEN_FILE: "/run/token", BACKEND_API_KEY_FILE: "/run/key" }, (path) => files[path] ?? "");
  assert.equal(config.connectionToken, token);
  assert.equal(config.backend.apiKey, key);
  assert.equal(config.port, 8750);
  assert.equal(config.trustCallerContext, false);
});

test("config requires a connection token", () => {
  assert.throws(() => loadConfig({ BACKEND_API_KEY: key }), /CONNECTION_TOKEN or CONNECTION_TOKEN_FILE is required/u);
});

test("config refuses a token given both inline and as a file", () => {
  assert.throws(() => loadConfig({ CONNECTION_TOKEN: token, CONNECTION_TOKEN_FILE: "/run/token", BACKEND_API_KEY: key }), /not both/u);
});

test("config refuses a short connection token without printing it", () => {
  assert.throws(
    () => loadConfig({ CONNECTION_TOKEN: "short-secret-value", BACKEND_API_KEY: key }),
    (error: unknown) => error instanceof Error && /at least 32/u.test(error.message) && !error.message.includes("short-secret-value"),
  );
});

test("config rejects an invalid trust flag", () => {
  assert.throws(() => loadConfig({ CONNECTION_TOKEN: token, BACKEND_API_KEY: key, TRUST_CALLER_CONTEXT: "yes" }), /TRUST_CALLER_CONTEXT/u);
});
