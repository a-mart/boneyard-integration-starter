import type { CallToolResult } from "@modelcontextprotocol/server";

export function resultBytes(result: CallToolResult): number {
  return Buffer.byteLength(JSON.stringify(result), "utf8");
}

export function jsonResult(value: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

export function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

export function boundedListResult<T>(
  items: readonly T[],
  maxBytes: number,
  wrap: (kept: readonly T[], truncated: boolean) => Record<string, unknown>,
): CallToolResult {
  for (let count = items.length; count >= 0; count -= 1) {
    const result = jsonResult(wrap(items.slice(0, count), count < items.length));
    if (resultBytes(result) <= maxBytes) return result;
  }
  return toolError("The result is too large to return. Narrow the request.");
}
