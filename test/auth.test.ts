import assert from "node:assert/strict";
import { test } from "node:test";

import { createTokenVerifier } from "../src/auth.js";

const verify = createTokenVerifier("a".repeat(40));

test("the verifier accepts only the exact bearer token", () => {
  assert.equal(verify(`Bearer ${"a".repeat(40)}`), true);
  assert.equal(verify(`bearer ${"a".repeat(40)}`), true);
  assert.equal(verify(`Bearer ${"a".repeat(39)}`), false);
  assert.equal(verify(`Bearer ${"a".repeat(40)} extra`), false);
  assert.equal(verify("a".repeat(40)), false);
  assert.equal(verify(undefined), false);
});
