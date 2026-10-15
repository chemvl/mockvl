import "../setup";
import { describe, expect, test } from "bun:test";
import { createConfiguredEmailSender } from "@/clients/email";

const BASE = {
  EMAIL_PROVIDER: undefined,
  RESEND_API_KEY: undefined,
  RESEND_FROM_ADDRESS: undefined,
  SMTP_HOST: undefined,
  SMTP_PORT: 25,
  SMTP_USERNAME: undefined,
  SMTP_PASSWORD: undefined,
  SMTP_FROM_ADDRESS: undefined,
} as const;

describe("createConfiguredEmailSender", () => {
  test("unset provider with no credentials returns undefined (workers keep log-only defaults)", () => {
    expect(createConfiguredEmailSender({ ...BASE })).toBeUndefined();
  });

  test("unset provider auto-detects Resend when its pair is present (legacy behavior)", () => {
    const sender = createConfiguredEmailSender({
      ...BASE,
      RESEND_API_KEY: "re_123",
      RESEND_FROM_ADDRESS: "noreply@yourdomain.com",
    });
    expect(sender).toBeDefined();
  });

  test('"log-only" returns a sender that resolves without touching the network', async () => {
    const sender = createConfiguredEmailSender({ ...BASE, EMAIL_PROVIDER: "log-only" });
    expect(sender).toBeDefined();
    await sender?.send({ to: "user@example.com", subject: "hi", html: "<p>hi</p>" });
  });

  test('"resend" without its pair throws (defense in depth behind env.ts)', () => {
    expect(() => createConfiguredEmailSender({ ...BASE, EMAIL_PROVIDER: "resend" })).toThrow(
      /RESEND_API_KEY/,
    );
  });

  test('"smtp" returns a sender when host and from address are present (no auth needed)', () => {
    const sender = createConfiguredEmailSender({
      ...BASE,
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM_ADDRESS: "noreply@yourdomain.com",
    });
    expect(sender).toBeDefined();
  });

  test('"smtp" without a host throws (defense in depth behind env.ts)', () => {
    expect(() =>
      createConfiguredEmailSender({
        ...BASE,
        EMAIL_PROVIDER: "smtp",
        SMTP_FROM_ADDRESS: "noreply@yourdomain.com",
      }),
    ).toThrow(/SMTP_HOST/);
  });

  test('"smtp" without a from address throws (defense in depth behind env.ts)', () => {
    expect(() =>
      createConfiguredEmailSender({
        ...BASE,
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "smtp.example.com",
      }),
    ).toThrow(/SMTP_FROM_ADDRESS/);
  });
});
