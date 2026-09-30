import { loadLocalConfig, runLocalCheck } from "./local.js";

const path = process.argv[2] ?? "kit.config.json";
runLocalCheck(loadLocalConfig(path), (text) => process.stdout.write(text)).then(
  (ok) => process.exit(ok ? 0 : 1),
  (error: unknown) => {
    process.stderr.write(`kit: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  },
);
