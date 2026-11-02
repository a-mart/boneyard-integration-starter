import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { authHeaders, REQUEST_TIMEOUT_MS, type Target } from "./target.js";

export async function connectTaskClient(target: Target, headers: Readonly<Record<string, string>> = authHeaders(target)): Promise<Client> {
  const client = new Client({ name: "boneyard-kit", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(target.url, { requestInit: { headers: { ...headers }, redirect: "manual" } }), { timeout: REQUEST_TIMEOUT_MS });
  return client;
}
