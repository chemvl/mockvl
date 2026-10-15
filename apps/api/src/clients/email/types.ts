// One transactional email. `html` is the primary body; `text` is the optional
// plain-text alternative for clients that want it.
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

// Delivery failures throw (UpstreamError from clients/http.ts) — unlike push,
// callers here are workers whose retry policy IS the error handling.
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
