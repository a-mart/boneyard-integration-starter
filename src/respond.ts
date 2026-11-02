import type { ServerResponse } from "node:http";

export function respond(response: ServerResponse, status: number, body: Record<string, string>, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers }).end(JSON.stringify(body));
}
