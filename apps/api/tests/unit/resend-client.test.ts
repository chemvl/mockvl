import "../setup";
import { describe, expect, test } from "bun:test";
import { createResendClient } from "@/clients/email/resend";
import { UpstreamError } from "@/lib/errors";

const API_KEY = "re_secret_api_key_value";

// Injected fetchFn, same technique as fcm-client.test.ts / http-client.test.ts:
// no network, and every outgoing request is captured for inspection.
function capturingFetch(status: number, body: unknown = { id: "email-1" }) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchFn, requests };
}

const MESSAGE = {
  to: "user@example.com",
  subject: "Verify your email address",
  html: "<p>hi</p>",
  text: "hi",
};

describe("createResendClient", () => {
  test("POSTs /emails with the from address and bearer auth", async () => {
    const { fetchFn, requests } = capturingFetch(200);
    const client = createResendClient({
      apiKey: API_KEY,
      fromAddress: "noreply@example.com",
      fetchFn,
    });

    await client.send(MESSAGE);

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe("https://api.resend.com/emails");
    expect(request?.init.method).toBe("POST");
    expect((request?.init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${API_KEY}`,
    );
    expect(JSON.parse(request?.init.body as string)).toEqual({
      from: "noreply@example.com",
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      html: MESSAGE.html,
      text: MESSAGE.text,
    });
  });

  test("omits text when not provided", async () => {
    const { fetchFn, requests } = capturingFetch(200);
    const client = createResendClient({
      apiKey: API_KEY,
      fromAddress: "noreply@example.com",
      fetchFn,
    });

    await client.send({ to: MESSAGE.to, subject: MESSAGE.subject, html: MESSAGE.html });

    const body = JSON.parse(requests[0]?.init.body as string) as Record<string, unknown>;
    expect("text" in body).toBe(false);
  });

  test("a non-retryable upstream failure maps to UpstreamError without the API key", async () => {
    const { fetchFn } = capturingFetch(422, { message: "invalid from" });
    const client = createResendClient({
      apiKey: API_KEY,
      fromAddress: "noreply@example.com",
      fetchFn,
    });

    const error = await client.send(MESSAGE).catch((e) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    // Credential safety: the key must never leak into the thrown error.
    const serialized = JSON.stringify({
      message: (error as Error).message,
      details: (error as UpstreamError).details,
    });
    expect(serialized).not.toContain(API_KEY);
    expect((error as UpstreamError).details).toMatchObject({ provider: "resend", status: 422 });
  });

  test("retries 5xx responses before failing", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response("oops", { status: 503 });
    }) as unknown as typeof fetch;
    const client = createResendClient({
      apiKey: API_KEY,
      fromAddress: "noreply@example.com",
      fetchFn,
    });

    const error = await client.send(MESSAGE).catch((e) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect(calls).toBe(3); // 1 attempt + the wrapper's default 2 retries
  }, 15_000);
});
