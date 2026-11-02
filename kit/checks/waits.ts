import { z } from "zod";

import { MAX_WAIT_SECONDS, WAIT_RESULT_FIELD } from "../../contract/boneyard.js";
import type { Tool } from "../calls.js";
import { counted, result, type CheckResult } from "../report.js";
import type { ExecutedCall } from "./behavior.js";

const PropertiesSchema = z.object({ properties: z.record(z.string(), z.unknown()) }).loose();
const BoundSchema = z.object({ maximum: z.number().optional() }).loose();
const StructuredSchema = z.record(z.string(), z.unknown());
const TIMEOUT_LIMITS: Readonly<Record<string, number>> = { timeoutSeconds: MAX_WAIT_SECONDS, timeoutMs: MAX_WAIT_SECONDS * 1_000 };

function properties(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  const parsed = PropertiesSchema.safeParse(schema);
  return parsed.success ? parsed.data.properties : {};
}

export function isWaitTool(tool: Tool): boolean {
  return WAIT_RESULT_FIELD in properties(tool.outputSchema);
}

function timeoutProblems(tool: Tool): string[] {
  const input = properties(tool.inputSchema);
  return Object.entries(TIMEOUT_LIMITS).flatMap(([name, limit]) => {
    if (!(name in input)) return [];
    const bound = BoundSchema.safeParse(input[name]);
    const maximum = bound.success ? bound.data.maximum : undefined;
    if (maximum !== undefined && maximum <= limit) return [];
    return [`${tool.name}: ${name} must have a maximum of at most ${limit}, so one wait ends well inside the gateway's 60-second call limit.`];
  });
}

export function checkWaitTools(tools: readonly Tool[]): CheckResult {
  const waits = tools.filter(isWaitTool);
  if (waits.length === 0) return result("follow.wait-tools", "safe", "pass", `No tool declares ${WAIT_RESULT_FIELD} in its output schema, so none is a wait tool.`);
  const warnings = waits.flatMap((tool) => [
    ...(tool.annotations?.readOnlyHint === true ? [] : [`${tool.name}: Boneyard calls a wait tool again and again and retries it after a lost answer only when it is read-only; set readOnlyHint: true.`]),
    ...timeoutProblems(tool),
  ]);
  const summary = warnings.length > 0 ? "Some wait tools need attention before Boneyard follow-ups can repeat them safely." : `${counted(waits.length, "wait tool is", "wait tools are")} read-only and wait at most ${MAX_WAIT_SECONDS} seconds.`;
  return result("follow.wait-tools", "safe", warnings.length > 0 ? "warn" : "pass", summary, warnings);
}

function ranOut(call: ExecutedCall): unknown {
  if (call.outcome.kind !== "result") return undefined;
  const structured = StructuredSchema.safeParse(call.outcome.result.structuredContent);
  return structured.success ? structured.data[WAIT_RESULT_FIELD] : undefined;
}

function answerProblems(call: ExecutedCall): string[] {
  if (call.outcome.kind !== "result") return [];
  const isError = call.outcome.result.isError;
  const timedOut = ranOut(call);
  const problems: string[] = [];
  if (call.durationMs > MAX_WAIT_SECONDS * 1_000) problems.push(`${call.call.tool} took ${call.durationMs} ms; answer within ${MAX_WAIT_SECONDS} seconds.`);
  if (isError !== true && typeof timedOut !== "boolean") problems.push(`${call.call.tool} answered without a boolean ${WAIT_RESULT_FIELD} in structuredContent.`);
  if (isError === true && timedOut === true) problems.push(`${call.call.tool} marked a wait that ran out as an error; ${WAIT_RESULT_FIELD}: true is a normal answer.`);
  return problems;
}

export function checkWaitCalls(tools: readonly Tool[], executed: readonly ExecutedCall[]): CheckResult {
  const waits = new Set(tools.filter(isWaitTool).map((tool) => tool.name));
  if (waits.size === 0) return result("follow.wait-calls", "fake", "pass", "No wait tools to call.");
  const calls = executed.filter((entry) => waits.has(entry.call.tool));
  const failures = calls.flatMap(answerProblems);
  const exercised = new Set(calls.filter((entry) => ranOut(entry) === true).map((entry) => entry.call.tool));
  const warnings = [...waits]
    .filter((name) => !exercised.has(name))
    .map((name) => `${name}: no fixture call answered ${WAIT_RESULT_FIELD}: true; add one with a short timeout that runs out, so the convention is tested.`);
  const status = failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
  const summary = status === "pass" ? `${counted(calls.length, "wait call", "wait calls")} answered in time and said whether it ran out.` : "Some wait calls break the timedOut convention Boneyard follow-ups rely on.";
  return result("follow.wait-calls", "fake", status, summary, [...failures, ...warnings]);
}
