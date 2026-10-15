import "../setup";

import { describe, expect, test } from "bun:test";
import { createFcmTokenProvider } from "@/clients/fcm/auth";
import { createFcmClient } from "@/clients/fcm/client";
import { createLogOnlyPushSender } from "@/clients/fcm/log-only";
import type { PushMessage } from "@/clients/fcm/types";

// A real (test-only) RSA key so crypto.subtle can sign the assertion.
async function generateTestPrivateKeyPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  );
  const der = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

function decodeJwtClaims(assertion: string): Record<string, unknown> {
  const [, claims] = assertion.split(".");
  if (!claims) throw new Error("malformed assertion");
  const padded = claims.replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(atob(padded));
}

const MESSAGE: PushMessage = {
  token: "device-token-1",
  title: "Hello",
  body: "World",
  imageUrl: null,
  data: { notificationId: "n1" },
};

describe("fcm token provider", () => {
  test("exchanges a signed JWT assertion and caches the token", async () => {
    const pem = await generateTestPrivateKeyPem();
    const requests: { url: string; body: URLSearchParams }[] = [];
    const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), body: init?.body as URLSearchParams });
      return Response.json({ access_token: "cached-token", expires_in: 3600 });
    }) as typeof fetch;

    const provider = createFcmTokenProvider({
      clientEmail: "svc@project.iam.gserviceaccount.com",
      privateKey: pem,
      fetchFn,
    });

    expect(await provider.getToken()).toBe("cached-token");
    expect(await provider.getToken()).toBe("cached-token");
    // Second getToken served from cache — one token-endpoint round-trip.
    expect(requests).toHaveLength(1);

    const request = requests[0];
    if (!request) throw new Error("no token request recorded");
    expect(request.url).toBe("https://oauth2.googleapis.com/token");
    expect(request.body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const claims = decodeJwtClaims(request.body.get("assertion") ?? "");
    expect(claims.iss).toBe("svc@project.iam.gserviceaccount.com");
    expect(claims.scope).toBe("https://www.googleapis.com/auth/firebase.messaging");
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
  });

  test("a failed token exchange surfaces as an error (no partial cache)", async () => {
    const pem = await generateTestPrivateKeyPem();
    const fetchFn = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const provider = createFcmTokenProvider({
      clientEmail: "svc@project.iam.gserviceaccount.com",
      privateKey: pem,
      fetchFn,
    });
    await expect(provider.getToken()).rejects.toThrow("token endpoint request failed");
  });
});

describe("fcm client", () => {
  const tokenProvider = { getToken: async () => "access-token" };

  function clientWith(response: Response, captured: { body?: unknown } = {}) {
    const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      captured.body = JSON.parse(String(init?.body));
      return response;
    }) as typeof fetch;
    return createFcmClient({ projectId: "proj", tokenProvider, fetchFn });
  }

  test("sends the HTTP v1 message shape and reports success", async () => {
    const captured: { body?: unknown } = {};
    const client = clientWith(Response.json({ name: "projects/proj/messages/1" }), captured);
    const result = await client.send(MESSAGE);
    expect(result).toEqual({ ok: true });
    expect(captured.body).toMatchObject({
      message: {
        token: "device-token-1",
        notification: { title: "Hello", body: "World" },
        data: { notificationId: "n1" },
      },
    });
  });

  test.each([
    [
      404,
      { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } },
      "unregistered",
    ],
    [400, { error: { status: "INVALID_ARGUMENT" } }, "invalid-token"],
    [429, { error: { status: "RESOURCE_EXHAUSTED" } }, "rate-limited"],
    [503, { error: { status: "UNAVAILABLE" } }, "server"],
    [418, { error: { status: "IM_A_TEAPOT" } }, "unknown"],
  ] as const)("maps HTTP %i to reason %s", async (status, payload, reason) => {
    const client = clientWith(Response.json(payload, { status }));
    const result = await client.send(MESSAGE);
    expect(result).toEqual({ ok: false, reason });
  });

  test("a non-JSON error body still maps by HTTP status", async () => {
    const client = clientWith(new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await client.send(MESSAGE)).toEqual({ ok: false, reason: "server" });
  });
});

describe("log-only push sender", () => {
  test("always reports success", async () => {
    const sender = createLogOnlyPushSender();
    expect(await sender.send(MESSAGE)).toEqual({ ok: true });
  });
});
