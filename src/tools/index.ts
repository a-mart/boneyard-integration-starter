import type { ToolRegistration } from "./context.js";
import { registerTicketAddComment } from "./ticket-add-comment.js";
import { registerTicketsSearch } from "./tickets-search.js";

export const TOOLS: readonly ToolRegistration[] = [registerTicketsSearch, registerTicketAddComment];
