import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

import { AGENT_TOOL_NAME_LIMIT, CALLER_CONTEXT_HEADERS, classifyTool, MAX_TOOL_RESULT_BYTES, SUGGESTED_MODE } from "../contract/boneyard.js";
import { callTool, describeOutcome, listAllTools } from "./calls.js";
import { authHeaders, connect, type Target } from "./target.js";

export interface DevCaller {
  readonly agentName: string;
  readonly personEmail: string | null;
  readonly channelName: string;
  readonly trigger: "interactive" | "routine";
  readonly sendContext: boolean;
}

export interface DevOptions {
  readonly connectionId: string;
  readonly agentName: string;
  readonly personEmail: string;
  readonly channelName: string;
  readonly trigger: "interactive" | "routine";
  readonly sendContext: boolean;
  readonly exec: readonly string[];
  readonly write?: (text: string) => void;
}

const HELP = `Commands:
  tools                          List tools as the Boneyard admin reviews them
  call <tool> [json-arguments]   Call a tool as the current caller
  as agent <name>                Act as another agent
  as person <email|none>         Set the person who started the run
  as channel <name>              Set the channel
  as trigger <interactive|routine>
  context on|off                 Send or omit Boneyard-* caller-context headers
  whoami                         Show the caller-context headers the next call sends
  help, quit`;

export function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed, "utf8").digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function callerContextHeaders(caller: DevCaller): Record<string, string> {
  if (!caller.sendContext) return {};
  const headers: Record<string, string> = {
    [CALLER_CONTEXT_HEADERS.agentId]: stableUuid(`agent:${caller.agentName}`),
    [CALLER_CONTEXT_HEADERS.agentName]: encodeURIComponent(caller.agentName),
    [CALLER_CONTEXT_HEADERS.runId]: randomUUID(),
    [CALLER_CONTEXT_HEADERS.toolCallId]: `call_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
    [CALLER_CONTEXT_HEADERS.channelId]: stableUuid(`channel:${caller.channelName}`),
    [CALLER_CONTEXT_HEADERS.channelName]: encodeURIComponent(caller.channelName),
    [CALLER_CONTEXT_HEADERS.trigger]: caller.trigger,
    [CALLER_CONTEXT_HEADERS.contextStatus]: "verified",
  };
  if (caller.personEmail !== null) {
    headers[CALLER_CONTEXT_HEADERS.personId] = stableUuid(`person:${caller.personEmail}`);
    headers[CALLER_CONTEXT_HEADERS.personEmail] = encodeURIComponent(caller.personEmail);
  }
  return headers;
}

function parseJsonArguments(text: string): Record<string, unknown> {
  if (text.trim().length === 0) return {};
  const value: unknown = JSON.parse(text);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Arguments must be a JSON object.");
  return Object.fromEntries(Object.entries(value));
}

async function listTools(target: Target, connectionId: string, write: (text: string) => void): Promise<void> {
  const session = await connect(target);
  try {
    for (const tool of await listAllTools(session)) {
      const toolClass = classifyTool(tool.annotations);
      const mode = SUGGESTED_MODE[toolClass];
      const entry = mode === "Allow" ? "boneyard" : "boneyard_ask";
      const exposed = `mcp__${entry}__${connectionId}__${tool.name}`;
      const clamp = exposed.length > AGENT_TOOL_NAME_LIMIT ? ` (over ${AGENT_TOOL_NAME_LIMIT} characters, will be clamped)` : "";
      write(`${tool.name}  [${toolClass}; suggested ${mode}; new tools start Off]\n  agents see: ${exposed}${clamp}\n  ${tool.description ?? "(no description)"}\n`);
    }
  } finally {
    await session.close();
  }
}

async function runCall(target: Target, caller: DevCaller, rest: string, write: (text: string) => void): Promise<void> {
  const match = /^(\S+)\s*(.*)$/su.exec(rest.trim());
  if (match?.[1] === undefined) return write("Usage: call <tool> [json-arguments]\n");
  const args = parseJsonArguments(match[2] ?? "");
  const context = callerContextHeaders(caller);
  const session = await connect(target, { ...authHeaders(target), ...context });
  const started = performance.now();
  try {
    const outcome = await callTool(session, match[1], args);
    const elapsed = Math.round(performance.now() - started);
    write(`-> ${describeOutcome(outcome)} in ${elapsed} ms as ${caller.agentName}${caller.sendContext ? "" : " (no caller context)"}\n`);
    if (outcome.kind !== "result") return;
    for (const block of outcome.result.content) write(`${block.type === "text" ? block.text : JSON.stringify(block)}\n`);
    if (outcome.bytes > MAX_TOOL_RESULT_BYTES) write(`WARNING: ${outcome.bytes} bytes exceeds the ${MAX_TOOL_RESULT_BYTES}-byte result cap.\n`);
  } finally {
    await session.close();
  }
}

export function applyAs(caller: DevCaller, rest: string): DevCaller | string {
  const match = /^(agent|person|channel|trigger)\s+(.+)$/u.exec(rest.trim());
  if (match?.[1] === undefined || match[2] === undefined) return "Usage: as agent|person|channel|trigger <value>";
  const value = match[2].trim();
  if (match[1] === "agent") return { ...caller, agentName: value };
  if (match[1] === "person") return { ...caller, personEmail: value === "none" ? null : value };
  if (match[1] === "channel") return { ...caller, channelName: value };
  if (value === "interactive" || value === "routine") return { ...caller, trigger: value };
  return "Trigger is interactive or routine.";
}

export async function handleCommand(target: Target, options: DevOptions, caller: DevCaller, line: string, write: (text: string) => void): Promise<DevCaller | null> {
  const [command = "", ...restParts] = line.trim().split(/\s+/u);
  const rest = line.trim().slice(command.length);
  if (command === "" || command === "help") write(`${HELP}\n`);
  else if (command === "quit" || command === "exit") return null;
  else if (command === "tools") await listTools(target, options.connectionId, write);
  else if (command === "call") await runCall(target, caller, rest, write);
  else if (command === "whoami") write(`${JSON.stringify(callerContextHeaders(caller), null, 2)}\n`);
  else if (command === "context" && (restParts[0] === "on" || restParts[0] === "off")) return { ...caller, sendContext: restParts[0] === "on" };
  else if (command === "as") {
    const next = applyAs(caller, rest);
    if (typeof next === "string") write(`${next}\n`);
    else return next;
  } else write(`Unknown command "${command}". Type help.\n`);
  return caller;
}

export async function runDev(target: Target, options: DevOptions): Promise<void> {
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  let caller: DevCaller | null = {
    agentName: options.agentName,
    personEmail: options.personEmail,
    channelName: options.channelName,
    trigger: options.trigger,
    sendContext: options.sendContext,
  };
  const run = async (line: string): Promise<void> => {
    if (caller === null) return;
    try {
      caller = await handleCommand(target, options, caller, line, write);
    } catch (error) {
      write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  };
  if (options.exec.length > 0) {
    for (const line of options.exec) await run(line);
    return;
  }
  const interactive = process.stdin.isTTY;
  write(`Mock Boneyard gateway for ${target.url.toString()} as ${options.agentName}. Type help.\n`);
  const input = createInterface({ input: process.stdin, terminal: interactive });
  if (interactive) write("kit> ");
  for await (const line of input) {
    await run(line);
    if (caller === null) break;
    if (interactive) write("kit> ");
  }
  input.close();
}
