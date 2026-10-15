import "../setup";
import { describe, expect, test } from "bun:test";
import { sign } from "hono/jwt";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { authMiddleware } from "@/middleware/auth";
import { signAccessToken } from "@/modules/auth/auth.tokens";

function protectedApp() {
  const app = createApp();
  app.get("/protected", authMiddleware(), (c) => c.json({ data: { userId: c.get("userId") } }));
  return app;
}

async function requestProtected(headers: Record<string, string> = {}) {
  const res = await protectedApp().request("/api/protected", { headers });
  return {
    res,
    body: (await res.json()) as { data?: { userId: string }; error?: { code: string } },
  };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("authMiddleware", () => {
  test("rejects a missing Authorization header", async () => {
    const { res, body } = await requestProtected();
    expect(res.status).toBe(401);
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  test("rejects a non-Bearer Authorization header", async () => {
    const { res } = await requestProtected({ Authorization: "Basic dXNlcjpwdw==" });
    expect(res.status).toBe(401);
  });

  test("rejects a garbage token", async () => {
    const { res, body } = await requestProtected({ Authorization: "Bearer not.a.jwt" });
    expect(res.status).toBe(401);
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  test("rejects a token signed with the wrong secret", async () => {
    const token = await signAccessToken({
      sub: "user-1",
      secret: "wrong-secret-that-is-32-chars-long!!",
      ttlSeconds: 900,
    });
    const { res } = await requestProtected({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
  });

  test("rejects a token whose type is not access", async () => {
    const token = await sign(
      { sub: "user-1", type: "refresh", iat: nowSeconds(), exp: nowSeconds() + 900 },
      env.JWT_SECRET,
      "HS256",
    );
    const { res } = await requestProtected({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
  });

  test("rejects a token without a string sub", async () => {
    const token = await sign(
      { type: "access", iat: nowSeconds(), exp: nowSeconds() + 900 },
      env.JWT_SECRET,
      "HS256",
    );
    const { res } = await requestProtected({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
  });

  test("rejects an expired token", async () => {
    const token = await sign(
      { sub: "user-1", type: "access", iat: nowSeconds() - 1800, exp: nowSeconds() - 900 },
      env.JWT_SECRET,
      "HS256",
    );
    const { res } = await requestProtected({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
  });

  test("accepts a valid token and exposes userId", async () => {
    const token = await signAccessToken({
      sub: "user-42",
      secret: env.JWT_SECRET,
      ttlSeconds: 900,
    });
    const { res, body } = await requestProtected({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(body.data?.userId).toBe("user-42");
  });
});
