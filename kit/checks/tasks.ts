import { setTimeout as delay } from "node:timers/promises";

import { isTerminal } from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema, CreateTaskResultSchema, McpError, type Task } from "@modelcontextprotocol/sdk/types.js";

import { TASK_PROTOCOL_VERSION } from "../../contract/boneyard.js";
import type { Tool } from "../calls.js";
import type { Fixtures } from "../fixtures.js";
import { counted, result, type CheckResult } from "../report.js";
import { sampleArguments } from "../schema-args.js";
import { connectTaskClient } from "../task-client.js";
import { REQUEST_TIMEOUT_MS, type Target } from "../target.js";
import type { Discovery } from "./catalog.js";
import { containsSecret } from "./secrets.js";

export const TASK_RUN_TIMEOUT_MS = 30_000;
const TASK_TTL_MS = 60_000;
const MAX_TASK_TOOLS_RUN = 5;
const UNKNOWN_TASK_ID = "kit-unknown-task";

interface Findings {
  readonly failures: string[];
  readonly warnings: string[];
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function taskTools(tools: readonly Tool[]): Tool[] {
  return tools.filter((tool) => tool.execution?.taskSupport === "optional" || tool.execution?.taskSupport === "required");
}

export function checkTaskSupport(discovery: Discovery): CheckResult {
  const tasked = taskTools(discovery.tools);
  if (tasked.length === 0) return result("follow.tasks", "safe", "pass", "No tool declares MCP task support; Boneyard follow-ups repeat tools instead.");
  const failures = discovery.taskCalls ? [] : ["The server lists task-capable tools but does not declare the tasks.requests.tools.call capability."];
  const warnings = [
    ...(discovery.protocolVersion === TASK_PROTOCOL_VERSION
      ? []
      : [`Negotiated ${discovery.protocolVersion}; MCP Tasks exist only on ${TASK_PROTOCOL_VERSION}, so Boneyard calls these tools directly. Serve them on an endpoint whose newest protocol is ${TASK_PROTOCOL_VERSION}.`]),
    ...tasked
      .filter((tool) => tool.execution?.taskSupport === "required")
      .map((tool) => `${tool.name}: taskSupport is required, but an agent's own call through Boneyard never runs as a task; use optional so a direct call still works.`),
  ];
  const status = failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
  const summary = status === "pass" ? `${counted(tasked.length, "tool runs", "tools run")} as MCP tasks on ${TASK_PROTOCOL_VERSION}.` : "Task support is declared in a way Boneyard cannot use.";
  return result("follow.tasks", "safe", status, summary, [...failures, ...warnings]);
}

function runArguments(tool: Tool, fixtures: Fixtures): Record<string, unknown> {
  return fixtures.tools[tool.name]?.find((entry) => entry.expect === "result")?.arguments ?? sampleArguments(tool.inputSchema);
}

async function startTask(client: Client, tool: string, args: Record<string, unknown>): Promise<Task> {
  const created = await client.request({ method: "tools/call", params: { name: tool, arguments: args } }, CreateTaskResultSchema, { task: { ttl: TASK_TTL_MS }, timeout: REQUEST_TIMEOUT_MS });
  return created.task;
}

async function settled(client: Client, taskId: string): Promise<Task> {
  const deadline = Date.now() + TASK_RUN_TIMEOUT_MS;
  for (;;) {
    const task = await client.experimental.tasks.getTask(taskId, { timeout: REQUEST_TIMEOUT_MS });
    if (task.status !== "working" || Date.now() > deadline) return task;
    await delay(Math.min(Math.max(task.pollInterval ?? 500, 100), 2_000));
  }
}

async function seenFromNewSession(target: Target, tool: string, taskId: string, findings: Findings): Promise<void> {
  const other = await connectTaskClient(target);
  try {
    await other.experimental.tasks.getTask(taskId, { timeout: REQUEST_TIMEOUT_MS });
  } catch (error) {
    if (!(error instanceof McpError)) throw error;
    findings.warnings.push(
      `${tool}: a new session cannot see the task. Boneyard keeps the session that started a task, but after its gateway restarts it checks from a new one and treats the task as lost; bind tasks to the connection's credential, not the session.`,
    );
  } finally {
    await other.close();
  }
}

async function runsToEnd(client: Client, target: Target, tool: Tool, args: Record<string, unknown>, secrets: readonly string[], findings: Findings): Promise<void> {
  const task = await startTask(client, tool.name, args);
  await seenFromNewSession(target, tool.name, task.taskId, findings);
  const ended = await settled(client, task.taskId);
  if (ended.status === "working") {
    findings.warnings.push(`${tool.name}: the task was still working after ${TASK_RUN_TIMEOUT_MS / 1_000} s; give the test backend a short delay so the kit can collect a result.`);
    return;
  }
  if (ended.status === "input_required") return void findings.failures.push(`${tool.name}: the task asked for input, which Boneyard cannot give, so a follow-up ends it with an error.`);
  if (ended.status === "cancelled") return void findings.failures.push(`${tool.name}: the task was cancelled although nobody asked.`);
  const answer = await client.experimental.tasks.getTaskResult(task.taskId, CallToolResultSchema, { timeout: REQUEST_TIMEOUT_MS });
  if (containsSecret(JSON.stringify(answer), secrets)) findings.failures.push(`${tool.name}: the task result contains a secret or canary value.`);
}

async function cancels(client: Client, tool: Tool, args: Record<string, unknown>, findings: Findings): Promise<void> {
  const task = await startTask(client, tool.name, args);
  try {
    await client.experimental.tasks.cancelTask(task.taskId, { timeout: REQUEST_TIMEOUT_MS });
  } catch (error) {
    const current = await client.experimental.tasks.getTask(task.taskId, { timeout: REQUEST_TIMEOUT_MS });
    if (error instanceof McpError && isTerminal(current.status)) return;
    throw error;
  }
  const after = await client.experimental.tasks.getTask(task.taskId, { timeout: REQUEST_TIMEOUT_MS });
  if (after.status !== "cancelled") findings.failures.push(`${tool.name}: after tasks/cancel the task is ${after.status}; Boneyard cancels a follow-up's task when it is stopped.`);
}

async function refusesUnknownTask(client: Client, findings: Findings): Promise<void> {
  try {
    await client.experimental.tasks.getTask(UNKNOWN_TASK_ID, { timeout: REQUEST_TIMEOUT_MS });
    findings.failures.push("tasks/get answered for a task that does not exist; answer with a JSON-RPC error so Boneyard knows the task is gone.");
  } catch (error) {
    if (!(error instanceof McpError)) findings.failures.push(`tasks/get for an unknown task failed at the transport: ${errorText(error)}.`);
  }
}

async function exercise(target: Target, tools: readonly Tool[], fixtures: Fixtures, secrets: readonly string[], findings: Findings): Promise<void> {
  const client = await connectTaskClient(target);
  try {
    for (const tool of tools) {
      const args = runArguments(tool, fixtures);
      try {
        await runsToEnd(client, target, tool, args, secrets, findings);
        await cancels(client, tool, args, findings);
      } catch (error) {
        findings.failures.push(`${tool.name}: ${errorText(error)}`);
      }
    }
    await refusesUnknownTask(client, findings);
  } finally {
    await client.close();
  }
}

export async function checkTaskRuns(target: Target, discovery: Discovery, fixtures: Fixtures, secrets: readonly string[]): Promise<CheckResult> {
  const tasked = taskTools(discovery.tools).slice(0, MAX_TASK_TOOLS_RUN);
  if (tasked.length === 0 || !discovery.taskCalls || discovery.protocolVersion !== TASK_PROTOCOL_VERSION) {
    return result("follow.task-runs", "fake", "pass", "No tool runs as an MCP task here.");
  }
  const findings: Findings = { failures: [], warnings: [] };
  try {
    await exercise(target, tasked, fixtures, secrets, findings);
  } catch (error) {
    findings.failures.push(`Could not run tasks: ${errorText(error)}`);
  }
  const status = findings.failures.length > 0 ? "fail" : findings.warnings.length > 0 ? "warn" : "pass";
  const summary = status === "pass" ? `${counted(tasked.length, "task tool", "task tools")} ran to a result, could be seen from a new session and could be cancelled.` : "Some task tools do not behave as Boneyard follow-ups expect.";
  return result("follow.task-runs", "fake", status, summary, [...findings.failures, ...findings.warnings]);
}
