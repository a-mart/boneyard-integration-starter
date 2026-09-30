import { createFakeTicketBackend } from "./backend/fake-tickets.js";
import type { ServerConfig } from "./config.js";
import { createApp } from "./http.js";
import { createLogger, type Logger } from "./log.js";
import type { ToolRegistration } from "./tools/context.js";
import { TOOLS } from "./tools/index.js";

export interface RunningServer {
  readonly url: string;
  close(): Promise<void>;
}

export interface StartOptions {
  readonly log?: Logger;
  readonly tools?: readonly ToolRegistration[];
}

export async function startServer(config: ServerConfig, options: StartOptions = {}): Promise<RunningServer> {
  const log = options.log ?? createLogger({ level: config.logLevel, secrets: [config.connectionToken, config.backend.apiKey] });
  const app = createApp({
    mcpPath: config.mcpPath,
    connectionToken: config.connectionToken,
    trustCallerContext: config.trustCallerContext,
    allowedOrigins: config.allowedOrigins,
    maxBodyBytes: config.maxBodyBytes,
    maxResultBytes: config.maxResultBytes,
    backend: createFakeTicketBackend({ acceptedKey: config.backend.apiKey }, config.backend.apiKey),
    backendPrincipal: "fake-ticket-service-account",
    tools: options.tools ?? TOOLS,
    log,
  });
  await new Promise<void>((resolve, reject) => {
    app.once("error", reject);
    app.listen(config.port, config.host, () => resolve());
  });
  const address = app.address();
  if (address === null || typeof address === "string") throw new Error("The server did not bind a TCP port.");
  const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
  const url = `http://${host}:${address.port}${config.mcpPath}`;
  log.info("server_started", { url, trustCallerContext: config.trustCallerContext, backend: config.backend.kind });
  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        app.closeAllConnections();
        app.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
