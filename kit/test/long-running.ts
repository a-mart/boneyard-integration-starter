import type { RawCallAnswer, RawCallHandler, RawTaskHandler } from "./raw-server.js";
import { textAnswer, wellBehavedCall } from "./well-behaved.js";

export const TASK_CAPABILITIES = { tools: {}, tasks: { cancel: {}, requests: { tools: { call: {} } } } };

export const WAIT_TOOL: Record<string, unknown> = {
  name: "job_wait",
  title: "Wait for the job",
  description: "Wait for the nightly job to finish, for up to the timeout.",
  inputSchema: { type: "object", properties: { timeoutSeconds: { type: "integer", minimum: 1, maximum: 50, description: "Seconds to wait." } }, additionalProperties: false },
  outputSchema: { type: "object", properties: { timedOut: { type: "boolean" } }, required: ["timedOut"] },
  annotations: { readOnlyHint: true, destructiveHint: false },
};

export const TASK_TOOL: Record<string, unknown> = {
  name: "report_build",
  title: "Build the report",
  description: "Build the monthly report as an MCP task.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false },
  execution: { taskSupport: "optional" },
};

export function waitAnswer(timedOut: boolean, isError = false): RawCallAnswer {
  return { status: 200, body: { content: [{ type: "text", text: timedOut ? "still running" : "done" }], structuredContent: { timedOut }, ...(isError ? { isError: true } : {}) } };
}

const validWait = (args: Record<string, unknown>): boolean => Object.keys(args).every((key) => key === "timeoutSeconds" && typeof args[key] === "number");

export function longRunningCall(waiting: (args: Record<string, unknown>) => RawCallAnswer = () => waitAnswer(true)): RawCallHandler {
  return (name, args, headers) => {
    if (name === "job_wait") return validWait(args) ? waiting(args) : textAnswer("Pass timeoutSeconds as a number.", true);
    if (name === "report_build") return Object.keys(args).length === 0 ? textAnswer("report built") : textAnswer("This tool takes no arguments.", true);
    return wellBehavedCall(name, args, headers);
  };
}

interface RawTask {
  readonly taskId: string;
  status: string;
  readonly createdAt: string;
  lastUpdatedAt: string;
  readonly ttl: number;
  readonly pollInterval: number;
}

const ok = (body: unknown): RawCallAnswer => ({ status: 200, body });
const notFound: RawCallAnswer = { rpcError: { code: -32602, message: "Task not found" } };

export function rawTasks(behavior: { readonly ignoresCancel?: boolean } = {}): RawTaskHandler {
  const tasks = new Map<string, RawTask>();
  const looks = new Map<string, number>();
  const touch = (task: RawTask, status: string): void => {
    task.status = status;
    task.lastUpdatedAt = new Date().toISOString();
  };
  return (method, params) => {
    if (method === "tools/call") {
      const now = new Date().toISOString();
      const task: RawTask = { taskId: `task-${tasks.size + 1}`, status: "working", createdAt: now, lastUpdatedAt: now, ttl: 60_000, pollInterval: 20 };
      tasks.set(task.taskId, task);
      return ok({ task });
    }
    const task = tasks.get(typeof params["taskId"] === "string" ? params["taskId"] : "");
    if (task === undefined) return notFound;
    if (method === "tasks/get") {
      const seen = (looks.get(task.taskId) ?? 0) + 1;
      looks.set(task.taskId, seen);
      if (task.status === "working" && seen >= 2) touch(task, "completed");
      return ok(task);
    }
    if (method === "tasks/result") return task.status === "completed" ? textAnswer("report built") : notFound;
    if (method === "tasks/cancel" && behavior.ignoresCancel !== true) touch(task, "cancelled");
    return ok(task);
  };
}
