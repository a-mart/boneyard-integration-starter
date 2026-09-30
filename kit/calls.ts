import type { CallToolResult } from "@modelcontextprotocol/client";
import { z } from "zod";

import type { Fixtures } from "./fixtures.js";
import { sampleArguments } from "./schema-args.js";
import { REQUEST_TIMEOUT_MS, type ClientSession } from "./target.js";

export type CallOutcome =
  | { readonly kind: "result"; readonly result: CallToolResult; readonly bytes: number }
  | { readonly kind: "protocol-error"; readonly code: number; readonly message: string }
  | { readonly kind: "failure"; readonly message: string };

export interface PlannedCall {
  readonly tool: string;
  readonly arguments: Record<string, unknown>;
  readonly expect: "result" | "error" | "refusal";
  readonly source: "fixture" | "synthesized";
}

const ProtocolErrorShape = z.object({ code: z.number().int(), message: z.string() }).loose();

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export async function callTool(session: ClientSession, tool: string, args: Record<string, unknown>): Promise<CallOutcome> {
  try {
    const result = await session.client.callTool({ name: tool, arguments: args }, { timeout: REQUEST_TIMEOUT_MS });
    return { kind: "result", result, bytes: Buffer.byteLength(JSON.stringify(result), "utf8") };
  } catch (error) {
    const shape = ProtocolErrorShape.safeParse(error);
    if (shape.success && shape.data.code < 0) return { kind: "protocol-error", code: shape.data.code, message: shape.data.message };
    return { kind: "failure", message: errorText(error) };
  }
}

const ListedToolSchema = z
  .object({
    name: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()),
    annotations: z.object({ readOnlyHint: z.unknown().optional(), destructiveHint: z.unknown().optional() }).loose().optional(),
  })
  .loose();

const ListPageSchema = z.object({ tools: z.array(ListedToolSchema), nextCursor: z.string().optional() }).loose();

export type Tool = z.infer<typeof ListedToolSchema>;

export async function listAllTools(session: ClientSession): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const params = cursor === undefined ? {} : { cursor };
    const page = await session.client.request({ method: "tools/list", params }, ListPageSchema, { timeout: REQUEST_TIMEOUT_MS });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor !== undefined && tools.length <= 5000);
  return tools;
}

export function planCalls(tools: readonly Tool[], fixtures: Fixtures): PlannedCall[] {
  return tools.flatMap((tool): PlannedCall[] => {
    const cases = fixtures.tools[tool.name];
    if (cases === undefined) return [{ tool: tool.name, arguments: sampleArguments(tool.inputSchema), expect: "result", source: "synthesized" }];
    return cases.map((entry) => ({ tool: tool.name, arguments: entry.arguments, expect: entry.expect, source: "fixture" }));
  });
}

export function describeOutcome(outcome: CallOutcome): string {
  if (outcome.kind === "result") return outcome.result.isError === true ? "tool error result" : "result";
  if (outcome.kind === "protocol-error") return `JSON-RPC error ${outcome.code} (${outcome.message})`;
  return `transport failure (${outcome.message})`;
}
