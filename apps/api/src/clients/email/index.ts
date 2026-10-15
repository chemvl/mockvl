import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { createLogOnlyEmailSender } from "./log-only";
import { createResendClient } from "./resend";
import { createSmtpClient } from "./smtp";
import type { EmailSender } from "./types";

export { createLogOnlyEmailSender } from "./log-only";
export { createResendClient } from "./resend";
export { createSmtpClient } from "./smtp";
export type { EmailMessage, EmailSender } from "./types";

// The slice of env the factory reads — injectable so tests pass fakes
// without touching the process environment.
export type EmailProviderEnv = Pick<
  typeof env,
  | "EMAIL_PROVIDER"
  | "RESEND_API_KEY"
  | "RESEND_FROM_ADDRESS"
  | "SMTP_HOST"
  | "SMTP_PORT"
  | "SMTP_USERNAME"
  | "SMTP_PASSWORD"
  | "SMTP_FROM_ADDRESS"
>;

// Resolves EMAIL_PROVIDER to a sender, or undefined when email delivery is
// not configured — callers then leave worker deps unset so the workers keep
// their log-only defaults. env.ts already fail-fast-validates that an
// explicitly selected provider has its credential pair; the throws below are
// defense in depth, not a user-facing error path.
export function createConfiguredEmailSender(
  source: EmailProviderEnv = env,
): EmailSender | undefined {
  switch (source.EMAIL_PROVIDER) {
    case "smtp": {
      const host = source.SMTP_HOST;
      if (!host) {
        throw new Error('EMAIL_PROVIDER="smtp" requires SMTP_HOST');
      }
      const fromAddress = source.SMTP_FROM_ADDRESS;
      if (!fromAddress) {
        throw new Error('EMAIL_PROVIDER="smtp" requires SMTP_FROM_ADDRESS');
      }
      const { SMTP_USERNAME: username, SMTP_PASSWORD: password } = source;
      return createSmtpClient({
        host,
        port: source.SMTP_PORT,
        fromAddress,
        // env.ts enforces the pair; the spread keeps exactOptionalPropertyTypes happy.
        ...(username !== undefined && password !== undefined ? { username, password } : {}),
      });
    }
    case "resend": {
      const apiKey = source.RESEND_API_KEY;
      const fromAddress = source.RESEND_FROM_ADDRESS;
      if (!apiKey || !fromAddress) {
        throw new Error('EMAIL_PROVIDER="resend" requires RESEND_API_KEY and RESEND_FROM_ADDRESS');
      }
      return createResendClient({ apiKey, fromAddress });
    }
    case "log-only":
      return createLogOnlyEmailSender();
    default: {
      // Unset: legacy auto-detect so pre-EMAIL_PROVIDER deploys are untouched.
      if (source.RESEND_API_KEY && source.RESEND_FROM_ADDRESS) {
        return createResendClient({
          apiKey: source.RESEND_API_KEY,
          fromAddress: source.RESEND_FROM_ADDRESS,
        });
      }
      logger.warn("email delivery not configured — workers run log-only");
      return undefined;
    }
  }
}
