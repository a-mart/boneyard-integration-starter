import { isTerminal, type CreateTaskOptions, type TaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import { InMemoryTaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js";
import type { Request, RequestId, Result, Task } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/server";

import type { Logger } from "../log.js";

export const MAX_RUNNING_TASKS = 10;

export type TaskWork = (signal: AbortSignal) => Promise<CallToolResult>;

export class ConnectionTaskStore implements TaskStore {
  private readonly tasks = new InMemoryTaskStore();
  private readonly running = new Map<string, AbortController>();
  private readonly log: Logger;

  constructor(log: Logger) {
    this.log = log;
  }

  createTask(taskParams: CreateTaskOptions, requestId: RequestId, request: Request): Promise<Task> {
    return this.tasks.createTask(taskParams, requestId, request);
  }

  getTask(taskId: string): Promise<Task | null> {
    return this.tasks.getTask(taskId);
  }

  storeTaskResult(taskId: string, status: "completed" | "failed", result: Result): Promise<void> {
    return this.tasks.storeTaskResult(taskId, status, result);
  }

  getTaskResult(taskId: string): Promise<Result> {
    return this.tasks.getTaskResult(taskId);
  }

  async updateTaskStatus(taskId: string, status: Task["status"], statusMessage?: string): Promise<void> {
    await this.tasks.updateTaskStatus(taskId, status, statusMessage);
    if (status === "cancelled") this.running.get(taskId)?.abort();
  }

  listTasks(cursor?: string): Promise<{ tasks: Task[]; nextCursor?: string }> {
    return this.tasks.listTasks(cursor);
  }

  hasRoom(): boolean {
    return this.running.size < MAX_RUNNING_TASKS;
  }

  runningCount(): number {
    return this.running.size;
  }

  run(taskId: string, work: TaskWork): void {
    const controller = new AbortController();
    this.running.set(taskId, controller);
    work(controller.signal)
      .then((result) => this.settle(taskId, result))
      .catch((error: unknown) => this.log.error("task_not_stored", { taskId, errorName: error instanceof Error ? error.name : typeof error }))
      .finally(() => this.running.delete(taskId));
  }

  close(): void {
    for (const controller of this.running.values()) controller.abort();
    this.tasks.cleanup();
  }

  private async settle(taskId: string, result: CallToolResult): Promise<void> {
    const task = await this.tasks.getTask(taskId);
    if (task === null || isTerminal(task.status)) return;
    await this.tasks.storeTaskResult(taskId, result.isError === true ? "failed" : "completed", result);
  }
}
