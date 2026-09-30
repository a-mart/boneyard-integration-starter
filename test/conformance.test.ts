import assert from "node:assert/strict";
import { test } from "node:test";

import { runChecks, type CheckOptions } from "../kit/check.js";
import { loadFixtures } from "../kit/fixtures.js";
import type { Report } from "../kit/report.js";
import { createTarget } from "../kit/target.js";
import { startTestServer, TEST_BACKEND_KEY, TEST_TOKEN } from "./helpers.js";

const fixtures = loadFixtures("kit.fixtures.json");

async function check(url: string, options: Partial<CheckOptions> = {}): Promise<Report> {
  return runChecks(createTarget({ url, token: TEST_TOKEN, authHeader: "Authorization", extraHeaders: {} }), { fake: true, canaries: [TEST_BACKEND_KEY], fixtures, ...options });
}

test("the reference server passes every kit check in safe and fake modes", async () => {
  const server = await startTestServer();
  for (const fake of [false, true]) {
    const report = await check(server.url, { fake });
    assert.deepEqual(report.checks.filter((entry) => entry.status !== "pass" && entry.status !== "skip"), []);
    assert.equal(report.checks.filter((entry) => entry.status === "skip").length, fake ? 0 : 6);
  }
});

test("a reference server that trusts caller context must declare it to the kit", async () => {
  const server = await startTestServer({ TRUST_CALLER_CONTEXT: "true" });
  const undeclared = await check(server.url);
  assert.equal(undeclared.checks.find((entry) => entry.id === "context.forged-ignored")?.status, "fail");
  const declared = await check(server.url, { trustsCallerContext: true });
  assert.deepEqual(declared.checks.filter((entry) => entry.status === "fail"), []);
});
