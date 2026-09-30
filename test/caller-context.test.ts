import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCallerContext } from "../src/caller-context.js";

const headers: Record<string, string> = {
  "Boneyard-Agent-Id": "6f1c1d52-3b1e-4c1a-9a53-0d0c7b1f5a10",
  "Boneyard-Agent-Name": "Help%20Desk%20Assistant",
  "Boneyard-Person-Email": "pat%40example.com",
  "Boneyard-Channel-Name": "caf%C3%A9",
  "Boneyard-Trigger": "routine",
  "Boneyard-Context-Status": "verified",
};

const lookup = (source: Record<string, string>) => (name: string) => source[name];

test("caller context is ignored unless the server trusts it", () => {
  assert.deepEqual(parseCallerContext(lookup(headers), false), { trusted: false });
});

test("trusted caller context is percent-decoded", () => {
  const context = parseCallerContext(lookup(headers), true);
  assert.equal(context.trusted, true);
  if (!context.trusted) return;
  assert.equal(context.agentName, "Help Desk Assistant");
  assert.equal(context.personEmail, "pat@example.com");
  assert.equal(context.channelName, "café");
  assert.equal(context.trigger, "routine");
  assert.equal(context.runId, null);
});

test("malformed caller-context values are dropped, not trusted", () => {
  const context = parseCallerContext(
    lookup({ "Boneyard-Agent-Id": "not-a-uuid", "Boneyard-Agent-Name": "%E0%A4%A", "Boneyard-Person-Email": "%00x@example.com", "Boneyard-Trigger": "sideways", "Boneyard-Channel-Name": "x".repeat(2000) }),
    true,
  );
  assert.deepEqual(context, {
    trusted: true,
    agentId: null,
    agentName: null,
    runId: null,
    toolCallId: null,
    channelId: null,
    channelName: null,
    trigger: null,
    personId: null,
    personEmail: null,
    contextStatus: null,
  });
});
