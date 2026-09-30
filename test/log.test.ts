import assert from "node:assert/strict";
import { test } from "node:test";

import { createLogger } from "../src/log.js";

test("the logger never writes secret values or sensitive keys", () => {
  const lines: string[] = [];
  const log = createLogger({ level: "info", secrets: ["super-secret-value"], write: (line) => lines.push(line) });
  log.info("event", { note: "contains super-secret-value inside", authorization: "Bearer abc", apiKey: "xyz", tool: "sample_tool" });
  log.debug("hidden", { note: "debug is below the level" });
  assert.equal(lines.length, 1);
  const line = lines[0] ?? "";
  assert.doesNotMatch(line, /super-secret-value|Bearer abc|xyz/u);
  assert.match(line, /"tool":"sample_tool"/u);
});
