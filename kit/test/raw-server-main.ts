import { readFileSync } from "node:fs";

import { startRawServer } from "./raw-server.js";
import { textAnswer, WELL_BEHAVED_TOOLS, wellBehavedCall } from "./well-behaved.js";

const leak = process.env["LEAK_FILE"];
const server = await startRawServer({
  token: readFileSync(process.env["TOKEN_FILE"] ?? "", "utf8").trim(),
  port: Number(process.env["PORT"]),
  tools: WELL_BEHAVED_TOOLS,
  onCall: (name, args, headers) => (leak === undefined ? wellBehavedCall(name, args, headers) : textAnswer(readFileSync(leak, "utf8"))),
});
process.once("SIGTERM", () => {
  server.close().then(() => process.exit(0), () => process.exit(1));
});
