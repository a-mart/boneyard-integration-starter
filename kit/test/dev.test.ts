import assert from "node:assert/strict";
import { test } from "node:test";

import { startTestServer, TEST_TOKEN } from "../../test/helpers.js";
import { applyAs, callerContextHeaders, runDev, stableUuid, type DevCaller } from "../dev.js";
import { createTarget } from "../target.js";

const caller: DevCaller = { agentName: "Help Desk", personEmail: "pat@example.com", channelName: "it support", trigger: "interactive", sendContext: true };

test("caller-context headers are percent-encoded and use stable ids", () => {
  const headers = callerContextHeaders(caller);
  assert.equal(headers["Boneyard-Agent-Name"], "Help%20Desk");
  assert.equal(headers["Boneyard-Person-Email"], "pat%40example.com");
  assert.equal(headers["Boneyard-Channel-Name"], "it%20support");
  assert.equal(headers["Boneyard-Agent-Id"], stableUuid("agent:Help Desk"));
  assert.match(headers["Boneyard-Run-Id"] ?? "", /^[0-9a-f-]{36}$/u);
  assert.notEqual(callerContextHeaders(caller)["Boneyard-Run-Id"], headers["Boneyard-Run-Id"]);
  assert.deepEqual(callerContextHeaders({ ...caller, sendContext: false }), {});
  assert.equal(callerContextHeaders({ ...caller, personEmail: null })["Boneyard-Person-Email"], undefined);
});

test("the as command switches the caller", () => {
  assert.deepEqual(applyAs(caller, "person none"), { ...caller, personEmail: null });
  assert.deepEqual(applyAs(caller, "trigger routine"), { ...caller, trigger: "routine" });
  assert.equal(typeof applyAs(caller, "trigger sideways"), "string");
});

test("the mock gateway lists tools and calls them as the chosen person", async () => {
  const server = await startTestServer({ TRUST_CALLER_CONTEXT: "true" });
  const output: string[] = [];
  await runDev(createTarget({ url: server.url, token: TEST_TOKEN, authHeader: "Authorization", extraHeaders: {} }), {
    connectionId: "helpdesk",
    agentName: "Help Desk",
    personEmail: "pat@example.com",
    channelName: "general",
    trigger: "interactive",
    sendContext: true,
    exec: ["tools", 'call ticket_add_comment {"ticketId":"T-1001","body":"hello"}', "context off", 'call ticket_add_comment {"ticketId":"T-1001","body":"again"}', "call nope {"],
    write: (text) => output.push(text),
  });
  const text = output.join("");
  assert.match(text, /mcp__boneyard__helpdesk__tickets_search/u);
  assert.match(text, /mcp__boneyard_ask__helpdesk__ticket_add_comment/u);
  assert.match(text, /pat@example\.com via Boneyard/u);
  assert.match(text, /"author":"Boneyard connection"/u);
  assert.match(text, /error: .*JSON/u);
});
