export type TicketStatus = "open" | "pending" | "closed";

export interface TicketSummary {
  readonly id: string;
  readonly title: string;
  readonly status: TicketStatus;
  readonly updatedAt: string;
  readonly snippet: string;
}

export interface TicketComment {
  readonly id: string;
  readonly ticketId: string;
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface TicketQuery {
  readonly text: string;
  readonly status: TicketStatus | null;
  readonly limit: number;
}

export interface NewComment {
  readonly ticketId: string;
  readonly body: string;
  readonly author: string;
}

export interface ExportQuery {
  readonly status: TicketStatus | null;
}

export interface TicketBackend {
  search(query: TicketQuery, signal: AbortSignal): Promise<{ readonly total: number; readonly tickets: readonly TicketSummary[] }>;
  get(ticketId: string, signal: AbortSignal): Promise<TicketSummary>;
  addComment(comment: NewComment, signal: AbortSignal): Promise<TicketComment>;
  exportTickets(query: ExportQuery, signal: AbortSignal): Promise<readonly TicketSummary[]>;
}

export type BackendErrorCode = "not_found" | "unauthorized" | "unavailable";

export class BackendError extends Error {
  readonly code: BackendErrorCode;

  constructor(code: BackendErrorCode, message: string) {
    super(message);
    this.name = "BackendError";
    this.code = code;
  }
}
