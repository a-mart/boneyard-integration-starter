export const CONTRACT_VERSION = "1";

export const PREFERRED_PROTOCOL_VERSION = "2026-07-28";
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"];

export const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/u;
export const PORTABLE_TOOL_NAME_PATTERN = /^[a-z0-9_]{1,32}$/u;
export const MAX_TOOLS = 500;
export const MAX_TOOL_TITLE_LENGTH = 200;
export const MAX_TOOL_DESCRIPTION_LENGTH = 8000;
export const MAX_TOOL_RESULT_BYTES = 262_144;
export const AGENT_TOOL_NAME_LIMIT = 64;
export const AGENT_TOOL_PREFIX = "mcp__boneyard_ask__";

export const CALLER_CONTEXT_HEADERS = {
  agentId: "Boneyard-Agent-Id",
  agentName: "Boneyard-Agent-Name",
  runId: "Boneyard-Run-Id",
  toolCallId: "Boneyard-Tool-Call-Id",
  channelId: "Boneyard-Channel-Id",
  channelName: "Boneyard-Channel-Name",
  trigger: "Boneyard-Trigger",
  personId: "Boneyard-Person-Id",
  personEmail: "Boneyard-Person-Email",
  contextStatus: "Boneyard-Context-Status",
} as const;

export type CallerContextField = keyof typeof CALLER_CONTEXT_HEADERS;

export const CALLER_TRIGGERS = ["interactive", "routine", "unknown"] as const;
export const CALLER_CONTEXT_STATUSES = ["verified", "missing", "invalid"] as const;

export type ToolClass = "read" | "write" | "destructive";
export type SuggestedMode = "Allow" | "Ask" | "Off";

export interface AnnotationHints {
  readonly readOnlyHint?: unknown;
  readonly destructiveHint?: unknown;
}

export function classifyTool(annotations: AnnotationHints | undefined): ToolClass {
  if (annotations?.readOnlyHint === true) return "read";
  return annotations?.destructiveHint === false ? "write" : "destructive";
}

export const SUGGESTED_MODE: Readonly<Record<ToolClass, SuggestedMode>> = { read: "Allow", write: "Ask", destructive: "Off" };
