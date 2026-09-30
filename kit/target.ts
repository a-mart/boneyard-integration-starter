import { readFileSync } from "node:fs";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export interface Target {
  readonly url: URL;
  readonly authHeader: string;
  readonly authValue: string;
  readonly token: string;
  readonly extraHeaders: Readonly<Record<string, string>>;
}

export interface TargetInput {
  readonly url: string;
  readonly token: string;
  readonly authHeader: string;
  readonly extraHeaders: Readonly<Record<string, string>>;
}

export function readSecretFile(path: string, label: string): string {
  const value = readFileSync(path, "utf8").trim();
  if (value.length === 0) throw new Error(`${label} file ${path} is empty.`);
  return value;
}

export function createTarget(input: TargetInput): Target {
  const url = new URL(input.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The server URL must use http or https.");
  if (url.username !== "" || url.password !== "") throw new Error("Put credentials in --token-file, not in the URL.");
  const bearer = input.authHeader.toLowerCase() === "authorization";
  return { url, token: input.token, authHeader: input.authHeader, authValue: bearer ? `Bearer ${input.token}` : input.token, extraHeaders: input.extraHeaders };
}

export function authHeaders(target: Target): Record<string, string> {
  return { ...target.extraHeaders, [target.authHeader]: target.authValue };
}

export interface ClientSession {
  readonly client: Client;
  readonly protocolVersion: string | undefined;
  close(): Promise<void>;
}

export const REQUEST_TIMEOUT_MS = 15_000;

export async function connect(target: Target, headers: Readonly<Record<string, string>> = authHeaders(target)): Promise<ClientSession> {
  const client = new Client({ name: "boneyard-kit", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  const transport = new StreamableHTTPClientTransport(target.url, { requestInit: { headers: { ...headers }, redirect: "manual" } });
  await client.connect(transport, { timeout: REQUEST_TIMEOUT_MS });
  return { client, protocolVersion: client.getNegotiatedProtocolVersion(), close: () => client.close() };
}

export interface RawResponse {
  readonly status: number;
  readonly body: string;
  readonly headers: Headers;
}

export const LEGACY_INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "boneyard-kit", version: "1.0.0" } },
};

export async function rawPost(target: Target, headers: Readonly<Record<string, string>>, body: unknown = LEGACY_INITIALIZE): Promise<RawResponse> {
  const response = await fetch(target.url, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: response.status, body: await response.text(), headers: response.headers };
}
