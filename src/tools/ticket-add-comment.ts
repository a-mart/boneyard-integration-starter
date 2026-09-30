import { z } from "zod";

import type { CallerContext } from "../caller-context.js";
import { jsonResult } from "../output.js";
import { audited, type ToolRegistration } from "./context.js";

export const TICKET_ADD_COMMENT = "ticket_add_comment";

const InputSchema = z
  .object({
    ticketId: z.string().regex(/^T-[0-9]{1,8}$/u).describe("Ticket identifier, for example T-1001."),
    body: z.string().trim().min(1).max(4000).describe("Comment text to add to the ticket."),
  })
  .strict();

export function commentAuthor(caller: CallerContext): string {
  if (caller.trusted && caller.personEmail !== null) return `${caller.personEmail} via Boneyard`;
  if (caller.trusted && caller.agentName !== null) return `${caller.agentName} (Boneyard agent)`;
  return "Boneyard connection";
}

export const registerTicketAddComment: ToolRegistration = (server, context) => {
  server.registerTool(
    TICKET_ADD_COMMENT,
    {
      title: "Add a ticket comment",
      description: "Add a comment to an existing help-desk ticket. This changes the ticket and cannot be undone by this server.",
      inputSchema: InputSchema,
      annotations: { title: "Add a ticket comment", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input, extra) =>
      audited(
        TICKET_ADD_COMMENT,
        context,
        async () => {
          const comment = await context.backend.addComment({ ticketId: input.ticketId, body: input.body, author: commentAuthor(context.caller) }, extra.mcpReq.signal);
          return jsonResult({ comment });
        },
        { resource: input.ticketId },
      ),
  );
};
