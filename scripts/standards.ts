import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";

const ROOTS = ["src", "kit", "contract", "test", "scripts"];
const MAX_FILE_LINES = 600;
const MAX_FUNCTION_LINES = 100;

function sourceFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts") && !path.split(/[\\/]/u).includes("node_modules"))
    .map((path) => join(root, path))
    .sort();
}

function lineOf(file: ts.SourceFile, position: number): number {
  return file.getLineAndCharacterOfPosition(position).line + 1;
}

function commentLines(file: ts.SourceFile, node: ts.Node, seen: Set<number>): number[] {
  const text = file.getFullText();
  const ranges = [...(ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []), ...(ts.getTrailingCommentRanges(text, node.getEnd()) ?? [])];
  const fresh = ranges.filter((range) => !seen.has(range.pos));
  for (const range of fresh) seen.add(range.pos);
  return fresh.map((range) => lineOf(file, range.pos));
}

function nodeProblems(file: ts.SourceFile, node: ts.Node): string[] {
  if (node.kind === ts.SyntaxKind.AnyKeyword) return [`${lineOf(file, node.getStart(file))}: \`any\` is not allowed; use unknown and narrow it`];
  if (ts.isNonNullExpression(node)) return [`${lineOf(file, node.getStart(file))}: non-null assertion is not allowed; handle the missing case`];
  if (ts.isFunctionLike(node) && "body" in node && node.body !== undefined) {
    const start = lineOf(file, node.getStart(file));
    const length = lineOf(file, node.getEnd()) - start + 1;
    if (length > MAX_FUNCTION_LINES) return [`${start}: function is ${length} lines; the limit is ${MAX_FUNCTION_LINES}`];
  }
  return [];
}

function checkSource(path: string, text: string): string[] {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const problems: string[] = [];
  const lines = text.split("\n").length;
  if (lines > MAX_FILE_LINES) problems.push(`1: file is ${lines} lines; the limit is ${MAX_FILE_LINES}`);
  const seen = new Set<number>();
  const visit = (node: ts.Node): void => {
    for (const line of commentLines(file, node, seen)) problems.push(`${line}: comments are not allowed; name things so they need none`);
    problems.push(...nodeProblems(file, node));
    for (const child of node.getChildren(file)) visit(child);
  };
  visit(file);
  return problems.map((problem) => `${path}:${problem}`);
}

const roots = process.argv.length > 2 ? process.argv.slice(2) : ROOTS;
const problems = roots.flatMap(sourceFiles).flatMap((path) => checkSource(path, readFileSync(path, "utf8")));
for (const problem of problems) process.stdout.write(`${problem}\n`);
process.stdout.write(problems.length === 0 ? "standards: ok\n" : `standards: ${problems.length} problems\n`);
process.exit(problems.length === 0 ? 0 : 1);
