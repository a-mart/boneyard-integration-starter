import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function standards(source: string): { readonly status: number | null; readonly output: string } {
  const dir = mkdtempSync(join(tmpdir(), "standards-"));
  try {
    writeFileSync(join(dir, "sample.ts"), source);
    const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/standards.ts", dir], { encoding: "utf8" });
    return { status: run.status, output: run.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the standards check accepts clean code, including slashes inside strings and regexes", () => {
  const clean = standards('export const url = "http://example.com/a//b";\nexport const pattern = /^\\/[a-z/]*$/u;\n');
  assert.equal(clean.status, 0, clean.output);
});

test("the standards check reports comments, any, non-null assertions and long functions", () => {
  const body = Array.from({ length: 101 }, (_, index) => `  const v${index} = ${index};`).join("\n");
  const result = standards(`// note\nexport const a: any = 1;\nexport const b = [1][0]!;\nexport function long(): void {\n${body}\n}\nexport const c = 1; /* trailing */\n`);
  assert.equal(result.status, 1);
  assert.match(result.output, /sample\.ts:1: comments/u);
  assert.match(result.output, /sample\.ts:107: comments/u);
  assert.match(result.output, /`any` is not allowed/u);
  assert.match(result.output, /non-null assertion/u);
  assert.match(result.output, /function is 103 lines/u);
});
