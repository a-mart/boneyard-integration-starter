import assert from "node:assert/strict";
import { test } from "node:test";

import { runChecks, type CheckOptions } from "../check.js";
import type { CheckStatus, Report } from "../report.js";
import { createTarget } from "../target.js";
import { startRawServer, type RawServerOptions } from "./raw-server.js";
import { TEST_TOKEN, textAnswer, WELL_BEHAVED_TOOLS, wellBehavedCall } from "./well-behaved.js";

const CANARY = "kit-test-canary-value-7f3a9c";

function statusOf(report: Report, id: string): CheckStatus | undefined {
  return report.checks.find((check) => check.id === id)?.status;
}

async function checkRaw(options: Partial<RawServerOptions>, checkOptions: Partial<CheckOptions> = {}): Promise<Report> {
  const server = await startRawServer({ token: TEST_TOKEN, tools: WELL_BEHAVED_TOOLS, onCall: wellBehavedCall, ...options });
  try {
    const target = createTarget({ url: server.url, token: TEST_TOKEN, authHeader: "Authorization", extraHeaders: {} });
    return await runChecks(target, { fake: true, canaries: [CANARY], ...checkOptions });
  } finally {
    await server.close();
  }
}

test("a well-behaved server passes every check in safe and fake modes", async () => {
  for (const fake of [false, true]) {
    const report = await checkRaw({}, { fake });
    assert.deepEqual(report.checks.filter((entry) => entry.status !== "pass" && entry.status !== "skip"), []);
    assert.equal(report.checks.filter((entry) => entry.status === "skip").length, fake ? 0 : 6);
  }
});

test("safe mode never calls a tool", async () => {
  let calls = 0;
  const report = await checkRaw({ onCall: () => ((calls += 1), textAnswer("ok")) }, { fake: false });
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

test("a tool that returns a canary fails the canary check", async () => {
  const report = await checkRaw({ onCall: (name, args, headers) => (name === "status_get" ? textAnswer(`leaked ${CANARY}`) : wellBehavedCall(name, args, headers)) });
  assert.equal(statusOf(report, "secrets.canary"), "fail");
});

test("a tool that echoes request headers fails the canary check without a canary file", async () => {
  const report = await checkRaw({ onCall: (_name, _args, headers) => textAnswer(JSON.stringify(headers)) }, { canaries: [] });
  assert.equal(statusOf(report, "secrets.canary"), "fail");
});

test("an oversized result fails the size check", async () => {
  const report = await checkRaw({ onCall: () => textAnswer("x".repeat(300_000)) });
  assert.equal(statusOf(report, "results.size"), "fail");
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
  const report = await checkRaw({ onCall: (name, args, headers) => (typeof args["item"] === "number" ? { status: 500, body: { error: "boom" } } : wellBehavedCall(name, args, headers)) });
  assert.equal(statusOf(report, "results.errors"), "fail");
});

test("a JSON-RPC error for invalid arguments is a warning", async () => {
  const report = await checkRaw({
    onCall: (name, args, headers) => (typeof args["item"] === "number" ? { rpcError: { code: -32602, message: "Invalid params" } } : wellBehavedCall(name, args, headers)),
  });
  assert.equal(statusOf(report, "results.errors"), "warn");
});

test("a server that uses forged caller context fails unless it declares trust", async () => {
  const echoPerson = { onCall: (_name: string, _args: Record<string, unknown>, headers: Record<string, unknown>) => textAnswer(`by ${String(headers["boneyard-person-email"])}`) };
  assert.equal(statusOf(await checkRaw(echoPerson), "context.forged-ignored"), "fail");
  const declared = await checkRaw(echoPerson, { trustsCallerContext: true });
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

test("a call the fixtures mark as a refusal fails the check when it succeeds", async () => {
  const fixtures = {
    tools: {
      status_get: [
        { arguments: { item: "../outside" }, expect: "refusal" as const },
        { arguments: { item: "missing" }, expect: "error" as const },
      ],
    },
  };
  const escaping = await checkRaw({}, { fixtures });
  assert.equal(statusOf(escaping, "calls.fixtures"), "fail");
  const refusing = await checkRaw({ onCall: (name, args, headers) => (name === "status_get" ? textAnswer("Refused.", true) : wellBehavedCall(name, args, headers)) }, { fixtures });
  assert.equal(statusOf(refusing, "calls.fixtures"), "pass");
});

test("an expected error that succeeds is only a warning", async () => {
  const report = await checkRaw({}, { fixtures: { tools: { status_get: [{ arguments: { item: "missing" }, expect: "error" }] } } });
  assert.equal(statusOf(report, "calls.fixtures"), "warn");
});
