import assert from "node:assert/strict";
import { test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { connectClient, startTestServer, TEST_BACKEND_KEY, TEST_TOKEN, textOf } from "./helpers.js";

async function post(url: string, headers: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

test("the MCP endpoint rejects missing and wrong tokens with 401", async () => {
  const server = await startTestServer();
  assert.equal((await post(server.url, {})).status, 401);
  const wrong = await post(server.url, { authorization: `Bearer ${"x".repeat(TEST_TOKEN.length)}` });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get("www-authenticate"), "Bearer");
});

test("browser origins are refused unless allowed", async () => {
  const server = await startTestServer();
  const response = await post(server.url, { authorization: `Bearer ${TEST_TOKEN}`, origin: "https://evil.example" });
  assert.equal(response.status, 403);
});

test("health is public and GET on the MCP endpoint is not allowed", async () => {
  const server = await startTestServer();
  const base = new URL(server.url);
  assert.equal((await fetch(new URL("/healthz", base))).status, 200);
  assert.equal((await fetch(server.url, { headers: { authorization: `Bearer ${TEST_TOKEN}` } })).status, 405);
});

test("tools are listed with annotations that match what they do", async () => {
  const server = await startTestServer();
  const client = await connectClient(server.url);
  const { tools } = await client.listTools();
  await client.close();
  const byName = new Map(tools.map((tool) => [tool.name, tool.annotations]));
  assert.deepEqual([...byName.keys()].sort(), ["ticket_add_comment", "tickets_search"]);
  assert.equal(byName.get("tickets_search")?.readOnlyHint, true);
  assert.equal(byName.get("ticket_add_comment")?.readOnlyHint, false);
  assert.equal(byName.get("ticket_add_comment")?.destructiveHint, false);
});

test("search returns ticket summaries as data and logs the call without secrets", async () => {
  const server = await startTestServer();
  const client = await connectClient(server.url);
  const result = await client.callTool({ name: "tickets_search", arguments: { query: "instructions" } });
  await client.close();
  assert.notEqual(result.isError, true);
  assert.match(textOf(result), /T-1005/u);
  const logs = server.logs.join("\n");
  assert.match(logs, /"event":"tool_call".*"tool":"tickets_search".*"outcome":"completed"/u);
  assert.doesNotMatch(logs, new RegExp(`${TEST_TOKEN}|${TEST_BACKEND_KEY}`, "u"));
});

test("search output is bounded and says when it was truncated", async () => {
  const server = await startTestServer({ MAX_RESULT_BYTES: "1024" });
  const client = await connectClient(server.url);
  const result = await client.callTool({ name: "tickets_search", arguments: { limit: 50 } });
  await client.close();
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") < 1200);
  assert.match(textOf(result), /"truncated":true/u);
});

test("backend failures come back as tool errors", async () => {
  const server = await startTestServer();
  const client = await connectClient(server.url);
  const missing = await client.callTool({ name: "ticket_add_comment", arguments: { ticketId: "T-424242", body: "hello" } });
  const invalid = await client.callTool({ name: "ticket_add_comment", arguments: { ticketId: 7 } });
  await client.close();
  assert.equal(missing.isError, true);
  assert.match(textOf(missing), /does not exist/u);
  assert.equal(invalid.isError, true);
});

test("an untrusting server ignores caller context when attributing a write", async () => {
  const server = await startTestServer();
  const client = await connectClient(server.url, { "Boneyard-Person-Email": "forged%40example.com" });
  const result = await client.callTool({ name: "ticket_add_comment", arguments: { ticketId: "T-1001", body: "hello" } });
  await client.close();
  assert.match(textOf(result), /"author":"Boneyard connection"/u);
});

test("a trusting server attributes a write to the person in the caller context", async () => {
  const server = await startTestServer({ TRUST_CALLER_CONTEXT: "true" });
  const client = await connectClient(server.url, { "Boneyard-Person-Email": "pat%40example.com", "Boneyard-Agent-Name": "Help%20Desk" });
  const result = await client.callTool({ name: "ticket_add_comment", arguments: { ticketId: "T-1001", body: "hello" } });
  await client.close();
  assert.match(textOf(result), /"author":"pat@example.com via Boneyard"/u);
  assert.match(server.logs.join("\n"), /"personEmail":"pat@example.com"/u);
});

test("the server speaks both the 2026-07-28 and 2025-11-25 protocol eras", async () => {
  const server = await startTestServer();
  const modern = await connectClient(server.url);
  assert.equal(modern.getNegotiatedProtocolVersion(), "2026-07-28");
  await modern.close();
  const legacy = new Client({ name: "legacy", version: "0" });
  await legacy.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: { authorization: `Bearer ${TEST_TOKEN}` } } }));
  assert.equal(legacy.getNegotiatedProtocolVersion(), "2025-11-25");
  assert.equal((await legacy.listTools()).tools.length, 2);
  await legacy.close();
});
