import { after } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/log.js";
import { startServer, type RunningServer } from "../src/server.js";
import type { ToolRegistration } from "../src/tools/context.js";

export const TEST_TOKEN = "test-connection-token-0123456789abcdef";
export const TEST_BACKEND_KEY = "test-backend-key-0123456789";

export interface TestServer extends RunningServer {
  readonly logs: string[];
}

const running: RunningServer[] = [];
after(async () => {
  await Promise.all(running.splice(0).map(async (server) => server.close()));
});

export async function startTestServer(env: Record<string, string> = {}, tools?: readonly ToolRegistration[]): Promise<TestServer> {
  const logs: string[] = [];
  const server = await startServer(loadConfig({ PORT: "0", CONNECTION_TOKEN: TEST_TOKEN, BACKEND_API_KEY: TEST_BACKEND_KEY, ...env }), {
    log: createLogger({ level: "debug", secrets: [TEST_TOKEN, TEST_BACKEND_KEY], write: (line) => logs.push(line) }),
    ...(tools === undefined ? {} : { tools }),
  });
  running.push(server);
  return { ...server, logs };
}

export async function connectClient(url: string, headers: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: "test", version: "0.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${TEST_TOKEN}`, ...headers } } }));
  return client;
}

export function textOf(result: { readonly content?: unknown }): string {
  const content = Array.isArray(result.content) ? result.content : [];
  return content.map((block: unknown) => (typeof block === "object" && block !== null && "text" in block ? String(block.text) : "")).join("");
}
