import { loadConfig } from "./config.js";
import { startServer } from "./server.js";

async function main(): Promise<void> {
  const running = await startServer(loadConfig(process.env));
  const stop = (): void => {
    running.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ level: "error", event: "start_failed", message: error instanceof Error ? error.message : "unknown" })}\n`);
  process.exit(1);
});
