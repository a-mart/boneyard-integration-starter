import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_WAIT_SECONDS } from "../contract/boneyard.js";
import { connectClient, startTestServer, textOf } from "./helpers.js";

const KNOWN_UPDATE = "2026-01-12T09:15:00Z";

test("the wait tool answers timedOut: true with the ticket as it is when nothing changes in time", async () => {
  const server = await startTestServer();
  const client = await connectClient(server.url);
  const started = Date.now();
  const result = await client.callTool({ name: "ticket_wait_for_update", arguments: { ticketId: "T-1001", since: KNOWN_UPDATE, timeoutSeconds: 1 } });
  await client.close();
  assert.ok(Date.now() - started >= 900);
  assert.notEqual(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    timedOut: true,
    ticket: { id: "T-1001", title: "Printer on floor 2 jams on duplex jobs", status: "open", updatedAt: KNOWN_UPDATE, snippet: "Duplex jobs jam after the first page. Single-sided jobs print normally." },
  });
});

test("the wait tool answers as soon as the ticket changes, without timedOut", async () => {
  const server = await startTestServer();
  const waiter = await connectClient(server.url);
  const writer = await connectClient(server.url);
  const started = Date.now();
  const waiting = waiter.callTool({ name: "ticket_wait_for_update", arguments: { ticketId: "T-1001", since: KNOWN_UPDATE, timeoutSeconds: 20 } });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await writer.callTool({ name: "ticket_add_comment", arguments: { ticketId: "T-1001", body: "Replaced the roller." } });
  const result = await waiting;
  await Promise.all([waiter.close(), writer.close()]);
  assert.ok(Date.now() - started < 5_000);
  assert.match(textOf(result), /"timedOut":false/u);
  assert.doesNotMatch(textOf(result), new RegExp(`"updatedAt":"${KNOWN_UPDATE}"`, "u"));
});

test(`the wait tool refuses waits longer than ${MAX_WAIT_SECONDS} seconds, which would outlast the gateway's call limit`, async () => {
  const server = await startTestServer();
  const client = await connectClient(server.url);
  const tooLong = await client.callTool({ name: "ticket_wait_for_update", arguments: { ticketId: "T-1001", since: KNOWN_UPDATE, timeoutSeconds: MAX_WAIT_SECONDS + 1 } });
  const missing = await client.callTool({ name: "ticket_wait_for_update", arguments: { ticketId: "T-424242", since: KNOWN_UPDATE, timeoutSeconds: 1 } });
  await client.close();
  assert.equal(tooLong.isError, true);
  assert.equal(missing.isError, true);
  assert.match(textOf(missing), /does not exist/u);
});
