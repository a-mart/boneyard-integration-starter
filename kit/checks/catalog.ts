import {
  AGENT_TOOL_NAME_LIMIT,
  AGENT_TOOL_PREFIX,
  classifyTool,
  MAX_TOOL_DESCRIPTION_LENGTH,
  MAX_TOOL_TITLE_LENGTH,
  MAX_TOOLS,
  PORTABLE_TOOL_NAME_PATTERN,
  SUGGESTED_MODE,
  SUPPORTED_PROTOCOL_VERSIONS,
  TOOL_NAME_PATTERN,
} from "../../contract/boneyard.js";
import { listAllTools, type Tool } from "../calls.js";
import { result, type CheckResult } from "../report.js";
import { connect, type Target } from "../target.js";
import { containsSecret } from "./secrets.js";

export interface Discovery {
  readonly protocolVersion: string;
  readonly serverName: string;
  readonly tools: readonly Tool[];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function discover(target: Target): Promise<{ readonly check: CheckResult; readonly discovery: Discovery | null }> {
  let session;
  try {
    session = await connect(target);
  } catch (error) {
    return { check: result("discovery", "safe", "fail", "Could not connect with a supported protocol version.", [errorText(error)]), discovery: null };
  }
  try {
    const version = session.protocolVersion ?? "unknown";
    const info = session.client.getServerVersion();
    const tools = await listAllTools(session);
    const serverName = `${info?.name ?? "unknown"} ${info?.version ?? ""}`.trim();
    const supported = SUPPORTED_PROTOCOL_VERSIONS.includes(version);
    const summary = `Negotiated ${version} with ${serverName}; ${tools.length} tools.`;
    const details = supported ? [] : [`Supported versions: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}.`];
    return { check: result("discovery", "safe", supported ? "pass" : "fail", summary, details), discovery: { protocolVersion: version, serverName, tools } };
  } catch (error) {
    return { check: result("discovery", "safe", "fail", "Connected but tools/list failed.", [errorText(error)]), discovery: null };
  } finally {
    await session.close();
  }
}

export function checkToolNames(tools: readonly Tool[]): CheckResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    if (!TOOL_NAME_PATTERN.test(tool.name)) failures.push(`"${tool.name}" must match ${TOOL_NAME_PATTERN.source}.`);
    else if (!PORTABLE_TOOL_NAME_PATTERN.test(tool.name)) {
      warnings.push(`"${tool.name}": prefer lowercase snake_case of 32 characters or fewer; agents see ${AGENT_TOOL_PREFIX}<connection>__<tool>, clamped to ${AGENT_TOOL_NAME_LIMIT} characters.`);
    }
    if (seen.has(tool.name)) failures.push(`"${tool.name}" is listed more than once.`);
    seen.add(tool.name);
  }
  if (tools.length > MAX_TOOLS) failures.push(`${tools.length} tools exceed the limit of ${MAX_TOOLS}.`);
  const status = failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
  return result("tools.names", "safe", status, failures.length > 0 ? "Some tool names break the contract." : "Tool names are valid and unique.", [...failures, ...warnings]);
}

export function checkAnnotations(tools: readonly Tool[]): CheckResult {
  const warnings: string[] = [];
  const modes: string[] = [];
  for (const tool of tools) {
    const hints = tool.annotations;
    if (typeof hints?.readOnlyHint !== "boolean") warnings.push(`${tool.name}: readOnlyHint is missing, so Boneyard treats it as a write tool.`);
    else if (hints.readOnlyHint === false && typeof hints.destructiveHint !== "boolean") {
      warnings.push(`${tool.name}: destructiveHint is missing on a write tool, so Boneyard treats it as destructive.`);
    }
    const toolClass = classifyTool(hints);
    modes.push(`${tool.name}: ${toolClass}, suggested ${SUGGESTED_MODE[toolClass]}`);
  }
  const summary = warnings.length > 0 ? "Some tools lack explicit annotations." : "Every tool declares readOnlyHint (and destructiveHint for writes).";
  return result("tools.annotations", "safe", warnings.length > 0 ? "warn" : "pass", summary, [...warnings, ...modes]);
}

export function checkInputSchemas(tools: readonly Tool[]): CheckResult {
  const failures = tools.filter((tool) => tool.inputSchema.type !== "object").map((tool) => `${tool.name}: inputSchema.type must be "object".`);
  return result("tools.input-schemas", "safe", failures.length > 0 ? "fail" : "pass", failures.length > 0 ? "Some input schemas are not objects; MCP clients, including the Boneyard gateway, reject the whole tool list." : "Every input schema is an object schema.", failures);
}

export function checkMetadata(tools: readonly Tool[]): CheckResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const tool of tools) {
    if ((tool.title ?? "").length > MAX_TOOL_TITLE_LENGTH) failures.push(`${tool.name}: title is longer than ${MAX_TOOL_TITLE_LENGTH} characters.`);
    const description = tool.description ?? "";
    if (description.length > MAX_TOOL_DESCRIPTION_LENGTH) failures.push(`${tool.name}: description is longer than ${MAX_TOOL_DESCRIPTION_LENGTH} characters.`);
    if (description.trim().length === 0) warnings.push(`${tool.name}: add a description; the admin reviews it and the agent relies on it.`);
  }
  const status = failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
  return result("tools.metadata", "safe", status, status === "pass" ? "Titles and descriptions fit the catalog limits." : "Some tool metadata needs attention.", [...failures, ...warnings]);
}

export function checkCatalogSecrets(discovery: Discovery, secrets: readonly string[]): CheckResult {
  const leaked = containsSecret(JSON.stringify(discovery), secrets);
  return result("secrets.catalog", "safe", leaked ? "fail" : "pass", leaked ? "The tool catalog contains the connection token or a canary." : "The tool catalog contains no connection token or canary.");
}
