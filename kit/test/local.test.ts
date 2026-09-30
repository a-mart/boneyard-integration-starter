import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { expand, LocalConfigSchema, runLocalCheck, type LocalConfig } from "../local.js";

function config(env: Record<string, string> = {}): LocalConfig {
  return LocalConfigSchema.parse({
    command: [process.execPath, "--import", "tsx", "kit/test/raw-server-main.ts"],
    env: { PORT: "{port}", TOKEN_FILE: "{token_file}", ...env },
    url: "http://127.0.0.1:{port}/mcp",
    canaryFiles: ["{random_file:canary}"],
  });
}

test("placeholders expand to the port and to stable random files", () => {
  const dir = mkdtempSync(join(tmpdir(), "kit-expand-"));
  try {
    const places = { port: 4321, dir };
    assert.equal(expand("http://127.0.0.1:{port}/mcp", places), "http://127.0.0.1:4321/mcp");
    const first = expand("{random_file:key}", places);
    assert.equal(expand("{random_file:key}", places), first);
    assert.ok(readFileSync(first, "utf8").length >= 32);
    assert.notEqual(readFileSync(expand("{token_file}", places), "utf8"), readFileSync(first, "utf8"));
    assert.equal(expand("fixtures/outside/secret.txt", places), "fixtures/outside/secret.txt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a local check launches the configured server and passes a well-behaved one", async () => {
  const output: string[] = [];
  assert.equal(await runLocalCheck(config(), (text) => output.push(text)), true);
  assert.match(output.join(""), /Mode: {3}fake/u);
});

test("a local check fails when the server leaks a canary file", async () => {
  const output: string[] = [];
  assert.equal(await runLocalCheck(config({ LEAK_FILE: "{random_file:canary}" }), (text) => output.push(text)), false);
  assert.match(output.join(""), /FAIL {2}secrets\.canary/u);
});
