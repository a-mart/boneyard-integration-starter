import type { Tool } from "@modelcontextprotocol/client";

import { MAX_TOOL_RESULT_BYTES } from "../../contract/boneyard.js";
import { callTool, describeOutcome, planCalls, type CallOutcome, type PlannedCall } from "../calls.js";
import type { Fixtures } from "../fixtures.js";
import { result, type CheckResult } from "../report.js";
import { invalidArguments } from "../schema-args.js";
import type { ClientSession } from "../target.js";
import { containsSecret } from "./secrets.js";

export interface ExecutedCall {
  readonly call: PlannedCall;
  readonly outcome: CallOutcome;
}

export async function executePlan(session: ClientSession, tools: readonly Tool[], fixtures: Fixtures): Promise<ExecutedCall[]> {
  const executed: ExecutedCall[] = [];
  for (const call of planCalls(tools, fixtures)) executed.push({ call, outcome: await callTool(session, call.tool, call.arguments) });
  return executed;
}

export function checkFixtureCoverage(tools: readonly Tool[], fixtures: Fixtures, executed: readonly ExecutedCall[]): CheckResult {
  const names = new Set(tools.map((tool) => tool.name));
  const problems = Object.keys(fixtures.tools).filter((name) => !names.has(name)).map((name) => `Fixtures name "${name}", which the server does not list.`);
  for (const { call, outcome } of executed) {
    const failed = outcome.kind !== "result" || outcome.result.isError === true;
    if (call.expect === "result" && failed) problems.push(`${call.tool} (${call.source} arguments) returned a ${describeOutcome(outcome)}.`);
    if (call.expect === "error" && !failed) problems.push(`${call.tool} was expected to return a tool error but succeeded.`);
  }
  const summary = problems.length > 0 ? "Some calls did not behave as the fixtures expect; add or fix fixtures for real coverage." : `${executed.length} calls behaved as expected.`;
  return result("calls.fixtures", "fake", problems.length > 0 ? "warn" : "pass", summary, problems);
}

export function checkCanaries(executed: readonly ExecutedCall[], secrets: readonly string[]): CheckResult {
  const leaks = executed
    .filter(({ outcome }) => containsSecret(JSON.stringify(outcome), secrets))
    .map(({ call }) => `${call.tool} returned a secret or canary value.`);
  const summary = leaks.length > 0 ? "A tool result echoed a secret." : `No secret or canary appeared in ${executed.length} tool results.`;
  return result("secrets.canary", "fake", leaks.length > 0 ? "fail" : "pass", summary, leaks);
}

export function checkResultSizes(executed: readonly ExecutedCall[], maxBytes: number = MAX_TOOL_RESULT_BYTES): CheckResult {
  const oversized: string[] = [];
  let largest = 0;
  for (const { call, outcome } of executed) {
    if (outcome.kind !== "result") continue;
    largest = Math.max(largest, outcome.bytes);
    if (outcome.bytes > maxBytes) oversized.push(`${call.tool} returned ${outcome.bytes} bytes.`);
  }
  const summary = oversized.length > 0 ? `Some results exceed ${maxBytes} bytes.` : `Largest result ${largest} bytes (cap ${maxBytes}).`;
  return result("results.size", "fake", oversized.length > 0 ? "fail" : "pass", summary, oversized);
}

export async function checkErrorsAsResults(session: ClientSession, tools: readonly Tool[]): Promise<CheckResult> {
  const failures: string[] = [];
  const warnings: string[] = [];
  let probed = 0;
  for (const tool of tools) {
    const args = invalidArguments(tool.inputSchema);
    if (args === null) continue;
    probed += 1;
    const outcome = await callTool(session, tool.name, args);
    if (outcome.kind === "result" && outcome.result.isError === true) continue;
    if (outcome.kind === "result") warnings.push(`${tool.name}: accepted invalid arguments ${JSON.stringify(args)}; validate input against the schema.`);
    else if (outcome.kind === "protocol-error") warnings.push(`${tool.name}: invalid arguments produced ${describeOutcome(outcome)}; return a tool result with isError so the agent can correct itself.`);
    else failures.push(`${tool.name}: invalid arguments produced a ${describeOutcome(outcome)}.`);
  }
  const unknown = await callTool(session, "kit_unknown_tool_probe", {});
  if (unknown.kind === "failure") failures.push(`An unknown tool name produced a ${describeOutcome(unknown)}.`);
  const status = failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
  const summary = status === "pass" ? `Invalid arguments on ${probed} tools came back as tool error results.` : "Some errors were not returned as tool results.";
  return result("results.errors", "fake", status, summary, [...failures, ...warnings]);
}
