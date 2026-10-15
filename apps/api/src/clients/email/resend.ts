// Resend sender over the shared HTTP wrapper (no npm dependency): the wrapper
// already retries 429/5xx with backoff and keeps the API key out of error
// messages, details, and logs.
import { createHttpClient } from "@/clients/http";
import type { EmailMessage, EmailSender } from "./types";

const RESEND_BASE_URL = "https://api.resend.com";

export interface ResendClientOptions {
  apiKey: string;
  // RFC 5322 from — plain address or "Name <addr@domain>".
  fromAddress: string;
  fetchFn?: typeof fetch;
}

export function createResendClient(options: ResendClientOptions): EmailSender {
  const { apiKey, fromAddress, fetchFn } = options;
  const http = createHttpClient({
    name: "resend",
    baseUrl: RESEND_BASE_URL,
    headers: { authorization: `Bearer ${apiKey}` },
    ...(fetchFn ? { fetchFn } : {}),
  });

  return {
    async send(message: EmailMessage): Promise<void> {
      // json() drains the {id} response body within the attempt's timeout;
      // the id itself is not needed.
      await http.json("/emails", {
        method: "POST",
        body: {
          from: fromAddress,
          to: message.to,
          subject: message.subject,
          html: message.html,
          ...(message.text ? { text: message.text } : {}),
        },
      });
    },
  };
}
