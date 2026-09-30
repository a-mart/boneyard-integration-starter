import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { z } from "zod";

const RpcRequestSchema = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number()]).optional(), method: z.string(), params: z.record(z.string(), z.unknown()).optional() });

export type RawCallAnswer = { readonly status: number; readonly body: unknown } | { readonly rpcError: { readonly code: number; readonly message: string } };

export type RawCallHandler = (name: string, args: Record<string, unknown>, headers: IncomingMessage["headers"]) => RawCallAnswer;

export interface RawServerOptions {
  readonly token: string;
  readonly checkToken?: boolean;
  readonly protocolVersion?: string;
  readonly tools: readonly Record<string, unknown>[];
  readonly onCall: RawCallHandler;
  readonly onRequest?: (headers: IncomingMessage["headers"]) => number | null;
}

export interface RawServer {
  readonly url: string;
  close(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" }).end(body === undefined ? undefined : JSON.stringify(body));
}

function rpcResult(id: string | number | undefined, result: unknown): unknown {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

async function handle(request: IncomingMessage, response: ServerResponse, options: RawServerOptions): Promise<void> {
  if (options.checkToken !== false && request.headers.authorization !== `Bearer ${options.token}`) return send(response, 401, { error: "unauthorized" });
  const forced = options.onRequest?.(request.headers) ?? null;
  if (forced !== null) return send(response, forced, { error: "forced" });
  const message = RpcRequestSchema.parse(JSON.parse(await readBody(request)));
  if (message.id === undefined) return send(response, 202, undefined);
  if (message.method === "initialize") {
    return send(response, 200, rpcResult(message.id, { protocolVersion: options.protocolVersion ?? "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "raw-server", version: "0.0.1" } }));
  }
  if (message.method === "tools/list") return send(response, 200, rpcResult(message.id, { tools: options.tools }));
  if (message.method === "tools/call") {
    const params = z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).default({}) }).parse(message.params);
    const answer = options.onCall(params.name, params.arguments, request.headers);
    if ("rpcError" in answer) return send(response, 200, { jsonrpc: "2.0", id: message.id, error: answer.rpcError });
    return send(response, answer.status, answer.status === 200 ? rpcResult(message.id, answer.body) : answer.body);
  }
  return send(response, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
}

export async function startRawServer(options: RawServerOptions): Promise<RawServer> {
  const server = createServer((request, response) => {
    handle(request, response, options).catch((error: unknown) => send(response, 500, { error: error instanceof Error ? error.message : "failed" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("raw server did not bind");
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
