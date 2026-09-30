import { z } from "zod";

import { CALLER_CONTEXT_HEADERS, CALLER_CONTEXT_STATUSES, CALLER_TRIGGERS } from "../contract/boneyard.js";

const MAX_HEADER_LENGTH = 1024;

function optional<T extends z.ZodType>(schema: T) {
  return schema.nullable().catch(null);
}

const ContextFieldsSchema = z.object({
  agentId: optional(z.uuid()),
  agentName: optional(z.string().min(1).max(200)),
  runId: optional(z.uuid()),
  toolCallId: optional(z.string().min(1).max(128)),
  channelId: optional(z.uuid()),
  channelName: optional(z.string().min(1).max(200)),
  trigger: optional(z.enum(CALLER_TRIGGERS)),
  personId: optional(z.uuid()),
  personEmail: optional(z.email().max(320)),
  contextStatus: optional(z.enum(CALLER_CONTEXT_STATUSES)),
});

export type TrustedCallerContext = { readonly trusted: true } & Readonly<z.infer<typeof ContextFieldsSchema>>;
export type CallerContext = TrustedCallerContext | { readonly trusted: false };

export const UNTRUSTED_CONTEXT: CallerContext = Object.freeze({ trusted: false });

export type HeaderLookup = (name: string) => string | undefined;

function decodeValue(raw: string | undefined): string | null {
  if (raw === undefined || raw.length === 0 || raw.length > MAX_HEADER_LENGTH) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
  return /[\u0000-\u001f\u007f]/u.test(decoded) ? null : decoded;
}

export function parseCallerContext(lookup: HeaderLookup, trusted: boolean): CallerContext {
  if (!trusted) return UNTRUSTED_CONTEXT;
  const raw = Object.fromEntries(Object.entries(CALLER_CONTEXT_HEADERS).map(([key, header]) => [key, decodeValue(lookup(header))]));
  return { trusted: true, ...ContextFieldsSchema.parse(raw) };
}
