import { logger } from "@/lib/logger";
import type { EmailMessage, EmailSender } from "./types";

// Delivery stand-in used when no email provider is configured, mirroring the
// FCM log-only sender: the template boots and the full email pipeline works
// without a provider account. Bodies are not logged — only recipient and
// subject.
export function createLogOnlyEmailSender(): EmailSender {
  return {
    async send(message: EmailMessage): Promise<void> {
      logger.info({ to: message.to, subject: message.subject }, "email sent (log-only)");
    },
  };
}
