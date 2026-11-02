import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, CreateTaskResultSchema, ErrorCode, McpError, type Task } from "@modelcontextprotocol/sdk/types.js";

import { MAX_TASK_TTL_MS } from "../contract/boneyard.js";
import { startTestServer, TEST_TOKEN, textOf } from "./helpers.js";

async function taskClient(url: string): Promise<Client> {
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${TEST_TOKEN}` } } }));
  return client;
}

async function startExport(client: Client, args: Record<string, unknown> = {}, ttl = 600_000): Promise<Task> {
  const created = await client.request({ method: "tools/call", params: { name: "tickets_export", arguments: args } }, CreateTaskResultSchema, { task: { ttl } });
  return created.task;
}

async function ended(client: Client, taskId: string): Promise<Task> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const task = await client.experimental.tasks.getTask(taskId);
    if (task.status !== "working" || Date.now() > deadline) return task;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test("the tasks endpoint declares tasks for tools/call and lists the export with optional task support", async () => {
  const server = await startTestServer();
  const client = await taskClient(server.tasksUrl);
  const { tools } = await client.listTools();
  const capabilities = client.getServerCapabilities();
  await client.close();
  assert.notEqual(capabilities?.tasks?.requests?.tools?.call, undefined);
  assert.deepEqual(tools.map((tool) => [tool.name, tool.execution?.taskSupport, tool.annotations?.readOnlyHint]), [["tickets_export", "optional", true]]);
});

test("an export runs as a task that any later request can check, as Boneyard does after its gateway restarts", async () => {
  const server = await startTestServer({ FAKE_EXPORT_DELAY_MS: "200" });
  const starter = await taskClient(server.tasksUrl);
  const task = await startExport(starter, { status: "open" }, 10 * MAX_TASK_TTL_MS);
  await starter.close();
  assert.equal(task.status, "working");
  assert.equal(task.ttl, MAX_TASK_TTL_MS);
  const checker = await taskClient(server.tasksUrl);
  assert.equal((await ended(checker, task.taskId)).status, "completed");
  const result = await checker.experimental.tasks.getTaskResult(task.taskId, CallToolResultSchema);
  await checker.close();
  assert.match(textOf(result), /T-1001/u);
  assert.doesNotMatch(textOf(result), /T-1004/u);
});

test("cancelling an export stops its work and the task stays cancelled", async () => {
  const server = await startTestServer({ FAKE_EXPORT_DELAY_MS: "5000" });
  const client = await taskClient(server.tasksUrl);
  const task = await startExport(client);
  await client.experimental.tasks.cancelTask(task.taskId);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal((await client.experimental.tasks.getTask(task.taskId)).status, "cancelled");
  await client.close();
  assert.match(server.logs.join("\n"), /"tool":"tickets_export","outcome":"cancelled"/u);
});

test("called without a task, the export answers like any other tool", async () => {
  const server = await startTestServer({ FAKE_EXPORT_DELAY_MS: "0" });
  const client = await taskClient(server.tasksUrl);
  const result = CallToolResultSchema.parse(await client.callTool({ name: "tickets_export", arguments: { status: "closed" } }));
  await client.close();
  assert.notEqual(result.isError, true);
  assert.match(textOf(result), /T-1004/u);
});

test("an unknown task is a protocol error, and the tasks endpoint needs the connection token", async () => {
  const server = await startTestServer();
  const client = await taskClient(server.tasksUrl);
  await assert.rejects(client.experimental.tasks.getTask("no-such-task"), (error: unknown) => error instanceof McpError && error.code === ErrorCode.InvalidParams);
  await client.close();
  const anonymous = await fetch(server.tasksUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(anonymous.status, 401);
});
