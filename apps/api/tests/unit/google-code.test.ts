import "../setup";
import { describe, expect, test } from "bun:test";
import { createGoogleCodeExchanger } from "@/modules/auth/google-code";

interface Captured {
  url: string;
  init: RequestInit;
}

function fakeFetch(response: Response, captured: Captured[]) {
  return async (url: string, init: RequestInit) => {
    captured.push({ url, init });
    return response;
  };
}

describe("createGoogleCodeExchanger", () => {
  test("posts the popup-code grant and returns the id_token", async () => {
    const captured: Captured[] = [];
    const exchanger = createGoogleCodeExchanger({
      clientId: "cid",
      clientSecret: "secret",
      fetch: fakeFetch(Response.json({ id_token: "the-id-token", access_token: "x" }), captured),
    });

    expect(await exchanger.exchange("4/abc")).toBe("the-id-token");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(captured[0]?.init.method).toBe("POST");
    const body = new URLSearchParams(String(captured[0]?.init.body));
    expect(Object.fromEntries(body)).toEqual({
      code: "4/abc",
      client_id: "cid",
      client_secret: "secret",
      redirect_uri: "postmessage",
      grant_type: "authorization_code",
    });
  });

  test("rejects on a non-2xx response", async () => {
    const exchanger = createGoogleCodeExchanger({
      clientId: "cid",
      clientSecret: "secret",
      fetch: fakeFetch(Response.json({ error: "invalid_grant" }, { status: 400 }), []),
    });
    await expect(exchanger.exchange("bad")).rejects.toThrow(/400/);
  });

  test("rejects when the response has no id_token", async () => {
    const exchanger = createGoogleCodeExchanger({
      clientId: "cid",
      clientSecret: "secret",
      fetch: fakeFetch(Response.json({ access_token: "x" }), []),
    });
    await expect(exchanger.exchange("code")).rejects.toThrow();
  });
});
