import assert from "node:assert/strict";
import { test } from "node:test";

import { invalidArguments, sampleArguments } from "../schema-args.js";

const schema = {
  type: "object",
  properties: {
    id: { type: "integer", minimum: 3 },
    email: { type: "string", format: "email" },
    kind: { type: "string", enum: ["a", "b"] },
    name: { type: "string", minLength: 12 },
    tags: { type: "array", items: { type: "string" }, minItems: 1 },
    optional: { type: "string" },
  },
  required: ["id", "email", "kind", "name", "tags"],
};

test("synthesized arguments fill required fields with schema-valid samples", () => {
  assert.deepEqual(sampleArguments(schema), { id: 3, email: "kit.sample@example.com", kind: "a", name: "kit-samplexx", tags: ["kit-sample"] });
});

test("invalid arguments drop required fields, or break the first property's type", () => {
  assert.deepEqual(invalidArguments(schema), {});
  assert.deepEqual(invalidArguments({ type: "object", properties: { q: { type: "string" } } }), { q: 12345 });
  assert.deepEqual(invalidArguments({ type: "object", additionalProperties: false }), { kit_unexpected_argument: 1 });
  assert.equal(invalidArguments({ type: "object" }), null);
});
