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

export interface TicketBackend {
  search(query: TicketQuery, signal: AbortSignal): Promise<{ readonly total: number; readonly tickets: readonly TicketSummary[] }>;
  addComment(comment: NewComment, signal: AbortSignal): Promise<TicketComment>;
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
