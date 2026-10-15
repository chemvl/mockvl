import "../setup";
import { describe, expect, mock, test } from "bun:test";
import type { AdminAuthService, AdminSessionResult } from "@/admin/auth/admin-auth.service";
import { roleAtLeast } from "@/admin/auth/roles";
import { createApp } from "@/app";
import type { AdminUser } from "@/db/schema";
import { ADMIN_SESSION_COOKIE, createRequireAdmin } from "@/middleware/admin-auth";
import { adminCsrf } from "@/middleware/admin-csrf";

function adminUser(role: AdminUser["role"]): AdminUser {
  return {
    id: crypto.randomUUID(),
    email: "ada@company.com",
    name: "Ada",
    avatarUrl: null,
    role,
    createdAt: new Date(),
  };
}

function fakeService(result: AdminSessionResult | null): AdminAuthService {
  return {
    validateSession: mock(async () => result),
  } as unknown as AdminAuthService;
}

function appWith(
  service: AdminAuthService,
  minRole: Parameters<ReturnType<typeof createRequireAdmin>>[0] = "viewer",
) {
  const app = createApp();
  const requireAdmin = createRequireAdmin(service);
  // Registered on the basePath'd app, so it serves at /api/admin/whoami.
  app.get("/admin/whoami", requireAdmin(minRole), (c) =>
    c.json({ data: { email: c.get("adminUser").email } }),
  );
  return app;
}

function sessionResult(
  role: AdminUser["role"],
  overrides: Partial<AdminSessionResult> = {},
): AdminSessionResult {
  return {
    adminUser: adminUser(role),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    renewed: false,
    ...overrides,
  };
}

const COOKIE = { cookie: `${ADMIN_SESSION_COOKIE}=some-raw-token` };

describe("roleAtLeast", () => {
  test("orders viewer < editor < owner", () => {
    expect(roleAtLeast("viewer", "viewer")).toBe(true);
    expect(roleAtLeast("viewer", "editor")).toBe(false);
    expect(roleAtLeast("editor", "viewer")).toBe(true);
    expect(roleAtLeast("editor", "owner")).toBe(false);
    expect(roleAtLeast("owner", "editor")).toBe(true);
    expect(roleAtLeast("owner", "owner")).toBe(true);
  });
});

describe("requireAdmin", () => {
  test("rejects a request without the session cookie", async () => {
    const res = await appWith(fakeService(sessionResult("viewer"))).request("/api/admin/whoami");

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  test("rejects an unknown or expired session and clears the cookie", async () => {
    const res = await appWith(fakeService(null)).request("/api/admin/whoami", { headers: COOKIE });

    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toContain(`${ADMIN_SESSION_COOKIE}=;`);
  });

  test("attaches the admin user for a valid session", async () => {
    const res = await appWith(fakeService(sessionResult("viewer"))).request("/api/admin/whoami", {
      headers: COOKIE,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { email: string } };
    expect(body.data.email).toBe("ada@company.com");
    // Fresh session: no cookie churn.
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("rejects a viewer when the route requires editor", async () => {
    const res = await appWith(fakeService(sessionResult("viewer")), "editor").request(
      "/api/admin/whoami",
      { headers: COOKIE },
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  test("allows an owner through an editor-gated route", async () => {
    const res = await appWith(fakeService(sessionResult("owner")), "editor").request(
      "/api/admin/whoami",
      { headers: COOKIE },
    );

    expect(res.status).toBe(200);
  });

  test("re-issues the cookie when the sliding expiry was renewed", async () => {
    const res = await appWith(fakeService(sessionResult("viewer", { renewed: true }))).request(
      "/api/admin/whoami",
      { headers: COOKIE },
    );

    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${ADMIN_SESSION_COOKIE}=some-raw-token`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
  });
});

describe("adminCsrf", () => {
  function csrfApp() {
    const app = createApp();
    app.use("/admin/*", adminCsrf());
    app.post("/admin/mutate", (c) => c.json({ data: { ok: true } }));
    app.get("/admin/read", (c) => c.json({ data: { ok: true } }));
    return app;
  }

  test("rejects a mutating /admin request without X-Requested-With", async () => {
    const res = await csrfApp().request("/api/admin/mutate", { method: "POST" });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  test("allows a mutating request carrying the header", async () => {
    const res = await csrfApp().request("/api/admin/mutate", {
      method: "POST",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    expect(res.status).toBe(200);
  });

  test("leaves safe methods alone", async () => {
    const res = await csrfApp().request("/api/admin/read");

    expect(res.status).toBe(200);
  });
});
