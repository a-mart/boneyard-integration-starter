import { randomBytes } from "node:crypto";

import type { Tool } from "@modelcontextprotocol/client";

import { CALLER_CONTEXT_HEADERS, classifyTool } from "../../contract/boneyard.js";
import { describeOutcome } from "../calls.js";
import type { Fixtures } from "../fixtures.js";
import { result, type CheckResult } from "../report.js";
import { authHeaders, connect, type Target } from "../target.js";
import { executePlan } from "./behavior.js";

export function forgedContextHeaders(marker: string): Record<string, string> {
  return {
    [CALLER_CONTEXT_HEADERS.agentId]: "11111111-1111-4111-8111-111111111111",
    [CALLER_CONTEXT_HEADERS.agentName]: encodeURIComponent(`Forged agent ${marker}`),
    [CALLER_CONTEXT_HEADERS.runId]: "22222222-2222-4222-8222-222222222222",
    [CALLER_CONTEXT_HEADERS.toolCallId]: `forged-${marker}`,
    [CALLER_CONTEXT_HEADERS.channelId]: "33333333-3333-4333-8333-333333333333",
    [CALLER_CONTEXT_HEADERS.channelName]: encodeURIComponent(`forged-channel-${marker}`),
    [CALLER_CONTEXT_HEADERS.trigger]: "interactive",
    [CALLER_CONTEXT_HEADERS.personId]: "44444444-4444-4444-8444-444444444444",
    [CALLER_CONTEXT_HEADERS.personEmail]: encodeURIComponent(`forged-${marker}@kit.invalid`),
    [CALLER_CONTEXT_HEADERS.contextStatus]: "verified",
  };
}

export const MALFORMED_CONTEXT_HEADERS: Readonly<Record<string, string>> = {
  [CALLER_CONTEXT_HEADERS.agentId]: "not-a-uuid",
  [CALLER_CONTEXT_HEADERS.agentName]: "%E0%A4%A",
  [CALLER_CONTEXT_HEADERS.channelName]: "x".repeat(4000),
  [CALLER_CONTEXT_HEADERS.trigger]: "sideways",
  [CALLER_CONTEXT_HEADERS.personEmail]: "%00%0Aattacker@example.com",
  [CALLER_CONTEXT_HEADERS.contextStatus]: "%FF",
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function checkForgedContextIgnored(target: Target, tools: readonly Tool[], fixtures: Fixtures, extra: Readonly<Record<string, string>>): Promise<CheckResult> {
  const marker = randomBytes(8).toString("hex");
  let session;
  try {
    session = await connect(target, { ...authHeaders(target), ...extra, ...forgedContextHeaders(marker) });
  } catch (error) {
    return result("context.forged-ignored", "fake", "fail", "Forged Boneyard-* headers broke the connection.", [errorText(error)]);
  }
  try {
    const executed = await executePlan(session, tools, fixtures);
    const echoed = executed.filter(({ outcome }) => JSON.stringify(outcome).includes(marker)).map(({ call }) => `${call.tool} used a forged Boneyard-* value.`);
    const summary = echoed.length > 0 ? "The server used caller context it was told not to trust." : `Forged Boneyard-* values never appeared in ${executed.length} results.`;
    return result("context.forged-ignored", "fake", echoed.length > 0 ? "fail" : "pass", summary, echoed);
  } finally {
    await session.close();
  }
}

export async function checkMalformedContextTolerated(target: Target, tools: readonly Tool[], fixtures: Fixtures, extra: Readonly<Record<string, string>>): Promise<CheckResult> {
  let session;
  try {
    session = await connect(target, { ...authHeaders(target), ...extra, ...MALFORMED_CONTEXT_HEADERS });
  } catch (error) {
    return result("context.malformed", "fake", "fail", "Malformed Boneyard-* headers made the server refuse the connection.", [errorText(error)]);
  }
  try {
    const readTools = tools.filter((tool) => classifyTool(tool.annotations) === "read");
    const executed = await executePlan(session, readTools.slice(0, 1), fixtures);
    const broken = executed.filter(({ outcome }) => outcome.kind === "failure").map(({ call, outcome }) => `${call.tool}: ${describeOutcome(outcome)}`);
    const summary = broken.length > 0 ? "Malformed caller-context headers broke a call." : "Malformed Boneyard-* headers are tolerated.";
    return result("context.malformed", "fake", broken.length > 0 ? "fail" : "pass", summary, broken);
  } finally {
    await session.close();
  }
}
