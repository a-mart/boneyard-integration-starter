import { randomBytes } from "node:crypto";

import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/log.js";
import { startServer } from "../src/server.js";
import { runChecks } from "./check.js";
import { loadFixtures } from "./fixtures.js";
import { formatReport, passed } from "./report.js";
import { createTarget } from "./target.js";

const token = randomBytes(32).toString("base64url");
const backendKey = randomBytes(24).toString("base64url");
const server = await startServer(loadConfig({ PORT: "0", CONNECTION_TOKEN: token, BACKEND_API_KEY: backendKey }), {
  log: createLogger({ level: "warn", secrets: [token, backendKey], write: (line) => process.stderr.write(`${line}\n`) }),
});
let ok = true;
try {
  const target = createTarget({ url: server.url, token, authHeader: "Authorization", extraHeaders: {} });
  for (const fake of [false, true]) {
    const report = await runChecks(target, { fake, canaries: [backendKey], fixtures: loadFixtures("kit.fixtures.json") });
    process.stdout.write(`${formatReport(report)}\n\n`);
    ok &&= passed(report);
  }
} finally {
  await server.close();
}
process.exit(ok ? 0 : 1);
