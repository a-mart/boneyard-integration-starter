import { z } from "zod";

const SchemaNode = z
  .object({
    type: z.union([z.string(), z.array(z.string())]).optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.unknown().optional(),
    enum: z.array(z.unknown()).min(1).optional(),
    const: z.unknown().optional(),
    default: z.unknown().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    minLength: z.number().int().nonnegative().optional(),
    minItems: z.number().int().nonnegative().optional(),
    format: z.string().optional(),
    items: z.unknown().optional(),
  })
  .loose();

type Node = z.infer<typeof SchemaNode>;

const MAX_DEPTH = 6;

function parseNode(schema: unknown): Node {
  const parsed = SchemaNode.safeParse(schema);
  return parsed.success ? parsed.data : {};
}

function primaryType(node: Node): string | undefined {
  if (Array.isArray(node.type)) return node.type.find((type) => type !== "null") ?? node.type[0];
  if (node.type !== undefined) return node.type;
  return node.properties === undefined ? undefined : "object";
}

function sampleString(node: Node): string {
  if (node.format === "email") return "kit.sample@example.com";
  if (node.format === "uuid") return "00000000-0000-4000-8000-000000000000";
  if (node.format === "date-time") return "2026-01-01T00:00:00Z";
  if (node.format === "date") return "2026-01-01";
  if (node.format === "uri") return "https://example.com/";
  return "kit-sample".padEnd(node.minLength ?? 0, "x");
}

function sampleNumber(node: Node, integer: boolean): number {
  const value = node.minimum ?? (node.maximum !== undefined && node.maximum < 1 ? node.maximum : 1);
  return integer ? Math.ceil(value) : value;
}

export function sampleValue(schema: unknown, depth = 0): unknown {
  const node = parseNode(schema);
  if (node.default !== undefined) return node.default;
  if (node.const !== undefined) return node.const;
  if (node.enum !== undefined) return node.enum[0];
  switch (primaryType(node)) {
    case "string":
      return sampleString(node);
    case "integer":
      return sampleNumber(node, true);
    case "number":
      return sampleNumber(node, false);
    case "boolean":
      return false;
    case "array":
      return depth >= MAX_DEPTH ? [] : Array.from({ length: node.minItems ?? 0 }, () => sampleValue(node.items, depth + 1));
    case "object":
      return depth >= MAX_DEPTH ? {} : sampleArguments(schema, depth + 1);
    default:
      return null;
  }
}

export function sampleArguments(schema: unknown, depth = 0): Record<string, unknown> {
  const node = parseNode(schema);
  const properties = node.properties ?? {};
  return Object.fromEntries((node.required ?? []).map((key) => [key, sampleValue(properties[key], depth)]));
}

export function invalidArguments(schema: unknown): Record<string, unknown> | null {
  const node = parseNode(schema);
  if ((node.required ?? []).length > 0) return {};
  const [first] = Object.entries(node.properties ?? {});
  if (first !== undefined) {
    const [key, property] = first;
    return { [key]: primaryType(parseNode(property)) === "string" ? 12345 : "kit-wrong-type" };
  }
  return node.additionalProperties === false ? { kit_unexpected_argument: 1 } : null;
}
