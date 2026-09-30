import assert from "node:assert/strict";
import { test } from "node:test";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { TOOLS } from "../../src/tools/index.js";
import { startTestServer, TEST_BACKEND_KEY, TEST_TOKEN } from "../../test/helpers.js";
import { runChecks, type CheckOptions } from "../check.js";
import { loadFixtures } from "../fixtures.js";
import type { CheckStatus, Report } from "../report.js";
import { createTarget } from "../target.js";
import { startRawServer, type RawServerOptions } from "./raw-server.js";

const fixtures = loadFixtures("kit.fixtures.json");

function statusOf(report: Report, id: string): CheckStatus | undefined {
  return report.checks.find((check) => check.id === id)?.status;
}

async function check(url: string, options: Partial<CheckOptions> = {}): Promise<Report> {
  return runChecks(createTarget({ url, token: TEST_TOKEN, authHeader: "Authorization", extraHeaders: {} }), { fake: true, canaries: [TEST_BACKEND_KEY], ...options });
}

async function checkRaw(options: Partial<RawServerOptions>, checkOptions: Partial<CheckOptions> = {}): Promise<Report> {
  const server = await startRawServer({
    token: TEST_TOKEN,
    tools: [{ name: "echo_status", description: "Status.", inputSchema: { type: "object", properties: { q: { type: "string" } } }, annotations: { readOnlyHint: true } }],
    onCall: () => ({ status: 200, body: { content: [{ type: "text", text: "ok" }] } }),
    ...options,
  });
  try {
    return await check(server.url, checkOptions);
  } finally {
    await server.close();
  }
}

function extraTool(name: string, text: () => string) {
  return (server: McpServer): void => {
    server.registerTool(name, { description: "Broken on purpose.", inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true } }, async () => ({
      content: [{ type: "text", text: text() }],
    }));
  };
}

test("the reference server passes every check in safe and fake modes", async () => {
  const server = await startTestServer();
  for (const fake of [false, true]) {
    const report = await check(server.url, { fake, fixtures });
    const notPassing = report.checks.filter((entry) => entry.status !== "pass" && entry.status !== "skip");
    assert.deepEqual(notPassing, []);
    assert.equal(report.checks.filter((entry) => entry.status === "skip").length, fake ? 0 : 6);
  }
});

test("safe mode never calls a tool", async () => {
  let calls = 0;
  const report = await checkRaw({ onCall: () => ((calls += 1), { status: 200, body: { content: [] } }) }, { fake: false });
  assert.equal(calls, 0);
  assert.equal(statusOf(report, "discovery"), "pass");
});

test("a server that accepts any token fails the auth checks", async () => {
  const report = await checkRaw({ checkToken: false });
  assert.equal(statusOf(report, "auth.missing"), "fail");
  assert.equal(statusOf(report, "auth.wrong"), "fail");
});

test("a server that answers 403 for a bad token gets a warning", async () => {
  const report = await checkRaw({ checkToken: false, onRequest: (headers) => (headers.authorization === `Bearer ${TEST_TOKEN}` ? null : 403) });
  assert.equal(statusOf(report, "auth.missing"), "warn");
});

test("a tool that echoes the backend secret fails the canary check", async () => {
  const server = await startTestServer({}, [...TOOLS, extraTool("leaky_debug", () => `key=${TEST_BACKEND_KEY}`)]);
  assert.equal(statusOf(await check(server.url, { fixtures }), "secrets.canary"), "fail");
});

test("a tool that echoes request headers fails the canary check without a canary file", async () => {
  const report = await checkRaw({ onCall: (_name, _args, headers) => ({ status: 200, body: { content: [{ type: "text", text: JSON.stringify(headers) }] } }) }, { canaries: [] });
  assert.equal(statusOf(report, "secrets.canary"), "fail");
});

test("an oversized result fails the size check", async () => {
  const server = await startTestServer({}, [...TOOLS, extraTool("dump_everything", () => "x".repeat(300_000))]);
  assert.equal(statusOf(await check(server.url, { fixtures }), "results.size"), "fail");
});

test("bad names, missing annotations and non-object schemas are reported", async () => {
  const report = await checkRaw({
    tools: [
      { name: "bad name!", inputSchema: { type: "object" } },
      { name: "string_input", description: "x", inputSchema: { type: "string" }, annotations: { readOnlyHint: false } },
    ],
  });
  assert.equal(statusOf(report, "tools.names"), "fail");
  assert.equal(statusOf(report, "tools.annotations"), "warn");
  assert.equal(statusOf(report, "tools.input-schemas"), "fail");
  assert.equal(statusOf(report, "tools.metadata"), "warn");
});

test("a transport failure on a bad call fails the errors-as-results check", async () => {
  const report = await checkRaw({ onCall: (_name, args) => (typeof args["q"] === "string" || Object.keys(args).length === 0 ? { status: 200, body: { content: [] } } : { status: 500, body: { error: "boom" } }) });
  assert.equal(statusOf(report, "results.errors"), "fail");
});

test("a JSON-RPC error for invalid arguments is a warning", async () => {
  const report = await checkRaw({
    onCall: (_name, args) =>
      typeof args["q"] === "number" ? { rpcError: { code: -32602, message: "Invalid params" } } : { status: 200, body: { content: [] } },
  });
  assert.equal(statusOf(report, "results.errors"), "warn");
});

test("a server that uses forged caller context fails when it should not trust it", async () => {
  const server = await startTestServer({ TRUST_CALLER_CONTEXT: "true" });
  assert.equal(statusOf(await check(server.url, { fixtures }), "context.forged-ignored"), "fail");
  const declared = await check(server.url, { fixtures, trustsCallerContext: true });
  assert.equal(statusOf(declared, "context.forged-ignored"), "skip");
  assert.equal(statusOf(declared, "context.malformed"), "pass");
});

test("a server that crashes on malformed caller context fails", async () => {
  const report = await checkRaw({ onRequest: (headers) => (headers["boneyard-agent-id"] === "not-a-uuid" ? 500 : null) });
  assert.equal(statusOf(report, "context.malformed"), "fail");
});

test("an unsupported protocol version fails discovery", async () => {
  const report = await checkRaw({ protocolVersion: "2024-11-05" });
  assert.equal(statusOf(report, "discovery"), "fail");
});
