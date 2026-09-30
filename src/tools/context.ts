import { createHash } from "node:crypto";

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";

import { BackendError, type TicketBackend } from "../backend/tickets.js";
import type { CallerContext } from "../caller-context.js";
import type { LogFields, Logger } from "../log.js";
import { toolError } from "../output.js";

export interface ToolContext {
  readonly backend: TicketBackend;
  readonly caller: CallerContext;
  readonly log: Logger;
  readonly maxResultBytes: number;
  readonly backendPrincipal: string;
}

export type ToolRegistration = (server: McpServer, context: ToolContext) => void;

function callerFields(caller: CallerContext): LogFields {
  if (!caller.trusted) return { callerTrusted: false };
  return {
    callerTrusted: true,
    agentId: caller.agentId,
    agentName: caller.agentName,
    runId: caller.runId,
    toolCallId: caller.toolCallId,
    channelId: caller.channelId,
    trigger: caller.trigger,
    personId: caller.personId,
    personEmail: caller.personEmail,
    contextStatus: caller.contextStatus,
  };
}

function failureResult(tool: string, context: ToolContext, error: unknown): { readonly result: CallToolResult; readonly outcome: string } {
  if (error instanceof BackendError) return { result: toolError(error.message), outcome: `backend_${error.code}` };
  if (error instanceof Error && error.name === "AbortError") return { result: toolError("The call was cancelled."), outcome: "cancelled" };
  context.log.error("tool_failed", { tool, errorName: error instanceof Error ? error.name : typeof error });
  return { result: toolError("The server could not complete this call. Try again later."), outcome: "internal_error" };
}

export interface AuditOptions {
  readonly resource?: string;
}

export function resourceHash(resource: string): string {
  return createHash("sha256").update(resource, "utf8").digest("hex").slice(0, 16);
}

export async function audited(tool: string, context: ToolContext, run: () => Promise<CallToolResult>, options: AuditOptions = {}): Promise<CallToolResult> {
  const started = performance.now();
  let settled: { readonly result: CallToolResult; readonly outcome: string };
  try {
    const result = await run();
    settled = { result, outcome: result.isError === true ? "tool_error" : "completed" };
  } catch (error) {
    settled = failureResult(tool, context, error);
  }
  context.log.info("tool_call", {
    tool,
    outcome: settled.outcome,
    durationMs: Math.round(performance.now() - started),
    backendPrincipal: context.backendPrincipal,
    ...(options.resource === undefined ? {} : { resourceHash: resourceHash(options.resource) }),
    ...callerFields(context.caller),
  });
  return settled.result;
}
