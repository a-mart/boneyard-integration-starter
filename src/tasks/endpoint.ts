import type { IncomingMessage, ServerResponse } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { respond } from "../respond.js";
import type { TaskToolContext, TaskToolRegistration } from "./tickets-export.js";

export const TASK_SERVER_INFO = Object.freeze({ name: "example-tickets-tasks", version: "0.1.0" });

const TASK_CAPABILITIES = { tools: { listChanged: false }, tasks: { cancel: {}, requests: { tools: { call: {} } } } };

export function buildTaskServer(context: TaskToolContext, tools: readonly TaskToolRegistration[]): McpServer {
  const server = new McpServer({ ...TASK_SERVER_INFO }, { capabilities: TASK_CAPABILITIES, taskStore: context.tasks });
  for (const register of tools) register(server, context);
  return server;
}

type Body = { readonly kind: "read"; readonly text: string } | { readonly kind: "too_large" };

async function readBody(request: IncomingMessage, maxBytes: number): Promise<Body> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > maxBytes) return { kind: "too_large" };
    chunks.push(buffer);
  }
  return { kind: "read", text: Buffer.concat(chunks).toString("utf8") };
}

function parsedJson(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false };
    throw error;
  }
}

export interface TaskEndpointOptions {
  readonly maxBodyBytes: number;
  readonly tools: readonly TaskToolRegistration[];
}

export async function serveTasks(request: IncomingMessage, response: ServerResponse, context: TaskToolContext, options: TaskEndpointOptions): Promise<void> {
  const body = await readBody(request, options.maxBodyBytes);
  if (body.kind === "too_large") return respond(response, 413, { error: "body_too_large" });
  const json = parsedJson(body.text);
  if (!json.ok) return respond(response, 400, { error: "invalid_json" });
  const server = buildTaskServer(context, options.tools);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  response.on("close", () => {
    Promise.all([transport.close(), server.close()]).catch((error: unknown) =>
      context.log.warn("task_request_close_failed", { errorName: error instanceof Error ? error.name : typeof error }),
    );
  });
  await server.connect(transport);
  await transport.handleRequest(request, response, json.value);
}
