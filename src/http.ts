import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

import { createTokenVerifier } from "./auth.js";
import type { TicketBackend } from "./backend/tickets.js";
import { parseCallerContext } from "./caller-context.js";
import type { Logger } from "./log.js";
import type { ToolContext, ToolRegistration } from "./tools/context.js";

export const SERVER_INFO = Object.freeze({ name: "example-tickets", version: "0.1.0" });

export interface AppOptions {
  readonly mcpPath: string;
  readonly connectionToken: string;
  readonly trustCallerContext: boolean;
  readonly allowedOrigins: readonly string[];
  readonly maxBodyBytes: number;
  readonly maxResultBytes: number;
  readonly backend: TicketBackend;
  readonly backendPrincipal: string;
  readonly tools: readonly ToolRegistration[];
  readonly log: Logger;
}

function respond(response: ServerResponse, status: number, body: Record<string, string>, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers }).end(JSON.stringify(body));
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
}

function pathOf(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://placeholder").pathname;
}

export function buildMcpServer(context: ToolContext, tools: readonly ToolRegistration[]): McpServer {
  const server = new McpServer(SERVER_INFO, { capabilities: { tools: { listChanged: false } } });
  for (const register of tools) register(server, context);
  return server;
}

async function serveMcp(request: IncomingMessage, response: ServerResponse, options: AppOptions): Promise<void> {
  const context: ToolContext = {
    backend: options.backend,
    backendPrincipal: options.backendPrincipal,
    caller: parseCallerContext((name) => header(request, name), options.trustCallerContext),
    log: options.log,
    maxResultBytes: options.maxResultBytes,
  };
  const handler = createMcpHandler(() => buildMcpServer(context, options.tools), {
    maxRequestBodySize: options.maxBodyBytes,
    onerror: (error) => options.log.warn("mcp_request_rejected", { errorName: error.name }),
  });
  try {
    await toNodeHandler(handler, { maxRequestBodySize: options.maxBodyBytes })(request, response);
  } finally {
    await handler.close();
  }
}

async function route(request: IncomingMessage, response: ServerResponse, options: AppOptions, verify: (value: string | undefined) => boolean): Promise<void> {
  const path = pathOf(request);
  if (request.method === "GET" && path === "/healthz") return respond(response, 200, { status: "ok" });
  if (path !== options.mcpPath) return respond(response, 404, { error: "not_found" });
  const origin = header(request, "origin");
  if (origin !== undefined && !options.allowedOrigins.includes(origin)) return respond(response, 403, { error: "origin_not_allowed" });
  if (!verify(header(request, "authorization"))) {
    options.log.warn("auth_rejected", { remote: request.socket.remoteAddress ?? null });
    return respond(response, 401, { error: "unauthorized" }, { "www-authenticate": "Bearer" });
  }
  if (request.method !== "POST") return respond(response, 405, { error: "method_not_allowed" }, { allow: "POST" });
  return serveMcp(request, response, options);
}

export function createApp(options: AppOptions): Server {
  const verify = createTokenVerifier(options.connectionToken);
  return createServer((request, response) => {
    route(request, response, options, verify).catch((error: unknown) => {
      options.log.error("request_failed", { errorName: error instanceof Error ? error.name : typeof error });
      if (response.headersSent) response.destroy();
      else respond(response, 500, { error: "internal_error" });
    });
  });
}
