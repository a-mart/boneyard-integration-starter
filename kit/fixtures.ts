import { readFileSync } from "node:fs";

import { z } from "zod";

const FixtureCaseSchema = z
  .object({
    arguments: z.record(z.string(), z.unknown()),
    expect: z.enum(["result", "error", "refusal"]).default("result"),
    note: z.string().max(500).optional(),
  })
  .strict();

export const FixturesSchema = z
  .object({
    tools: z.record(z.string(), z.array(FixtureCaseSchema).min(1).max(20)),
  })
  .strict();

export type Fixtures = z.infer<typeof FixturesSchema>;
export type FixtureCase = z.infer<typeof FixtureCaseSchema>;

export const NO_FIXTURES: Fixtures = { tools: {} };

export function loadFixtures(path: string | undefined): Fixtures {
  if (path === undefined) return NO_FIXTURES;
  const parsed = FixturesSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`Fixtures file ${path} is invalid: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
