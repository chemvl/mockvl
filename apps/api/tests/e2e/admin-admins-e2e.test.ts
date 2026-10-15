import "../setup";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createAdminAuthService } from "@/admin/auth/admin-auth.service";
import { createAdminSessionsRepo } from "@/admin/auth/admin-sessions.repo";
import { createAdminUsersRepo } from "@/admin/auth/admin-users.repo";
import type { GoogleClaims, GoogleOAuth } from "@/admin/auth/google";
import { META_RESOURCES_CACHE_PREFIX } from "@/admin/meta.routes";
import { createCrudRepo } from "@/admin/registry/crud.repo";
import { createCrudService } from "@/admin/registry/crud.service";
import type { AdminResourceDef } from "@/admin/registry/registry";
import { createDefaultAdminRegistry } from "@/admin/registry/resources";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import { invalidate } from "@/lib/cache";
import { prepareTestDatabase } from "../helpers/test-db";

// Admins resource acceptance (deferred 9b follow-up): owners manage admin
// roles through the generic CRUD engine — owner-only visibility, role-only
// updates, and the last-owner lockout guard. Real stack against Postgres +
// Redis; only the Google wire calls are faked, at the GoogleOAuth seam.
await prepareTestDatabase();

const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });
const { adminUsers, users } = schema;

const runTag = crypto.randomUUID();
const OWNER_EMAIL = `admins-e2e-owner-${runTag}@example.com`;
const EDITOR_EMAIL = `admins-e2e-editor-${runTag}@example.com`;
const VIEWER_EMAIL = `admins-e2e-viewer-${runTag}@example.com`;

let nextClaims: GoogleClaims = {};

const fakeGoogle: GoogleOAuth = {
  createAuthorizationRequest: (hdHint) => {
    const state = crypto.randomUUID();
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("hd", hdHint);
    return { state, codeVerifier: crypto.randomUUID(), url };
  },
  exchangeCode: async () => nextClaims,
};

const adminUsersRepo = createAdminUsersRepo(db);
const app = createApp({
  adminAuthService: createAdminAuthService({
    adminUsersRepo,
    adminSessionsRepo: createAdminSessionsRepo(db),
    google: fakeGoogle,
    allowedHd: env.GOOGLE_ALLOWED_HD,
    sessionSecret: env.ADMIN_SESSION_SECRET,
    seedOwnerEmail: OWNER_EMAIL,
  }),
  // The registry must be built on THIS file's pool: the admins hooks query
  // the DB, and the shared db singleton gets closed by db.test.ts's afterAll
  // when the whole suite runs.
  adminRegistry: createDefaultAdminRegistry({ adminUsersRepo }),
  crudServiceFactory: (def: AdminResourceDef) =>
    createCrudService({ repo: createCrudRepo(db, def.table), hooks: def.hooks }),
  rateLimit: {
    auth: { windowMs: 60_000, limit: 1_000 },
    global: { windowMs: 60_000, limit: 10_000 },
  },
});

let authorId: string;
let ownerCookie: string;
let editorCookie: string;
let viewerCookie: string;
let ownerId: string;
let editorId: string;

function cookieValue(res: Response, name: string): string | undefined {
  const header = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return header?.split(";")[0]?.slice(name.length + 1) || undefined;
}

async function login(email: string): Promise<string> {
  nextClaims = {
    sub: `google-${email}`,
    email,
    email_verified: true,
    hd: env.GOOGLE_ALLOWED_HD,
    name: "E2E Admin",
  };
  const start = await app.request("/api/admin/auth/google");
  const state = cookieValue(start, "admin_oauth_state");
  const verifier = cookieValue(start, "admin_oauth_verifier");
  if (!state || !verifier) throw new Error("start did not set the oauth cookies");
  const callback = await app.request(
    `/api/admin/auth/google/callback?code=fake-code&state=${state}`,
    {
      headers: { cookie: `admin_oauth_state=${state}; admin_oauth_verifier=${verifier}` },
    },
  );
  const token = cookieValue(callback, "admin_session");
  if (!token) throw new Error(`login failed for ${email}`);
  return `admin_session=${token}`;
}

function mutationHeaders(cookie: string) {
  return {
    cookie,
    "x-requested-with": "XMLHttpRequest",
    "content-type": "application/json",
  };
}

beforeAll(async () => {
  // The meta cache persists in Redis across runs; sweep it like boot does.
  await invalidate(`${META_RESOURCES_CACHE_PREFIX}*`);

  const [author] = await db
    .insert(users)
    .values({ email: `admins-e2e-author-${runTag}@example.com`, passwordHash: "x" })
    .returning();
  if (!author) throw new Error("author insert failed");
  authorId = author.id;

  ownerCookie = await login(OWNER_EMAIL);
  editorCookie = await login(EDITOR_EMAIL);
  viewerCookie = await login(VIEWER_EMAIL);

  const owner = await adminUsersRepo.findByEmail(OWNER_EMAIL);
  const editor = await adminUsersRepo.findByEmail(EDITOR_EMAIL);
  if (!owner || !editor) throw new Error("run admins missing");
  ownerId = owner.id;
  editorId = editor.id;
  await adminUsersRepo.updateRole(editorId, "editor");
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, authorId));
  // Admin deletions cascade to their sessions.
  await db
    .delete(adminUsers)
    .where(inArray(adminUsers.email, [OWNER_EMAIL, EDITOR_EMAIL, VIEWER_EMAIL]));
  await pool.end({ timeout: 5 });
});

describe("admins resource e2e (role management)", () => {
  test("owner lists admins; rows carry exactly the output schema shape", async () => {
    const res = await app.request(
      `/api/admin/admins?filter[email][like]=admins-e2e-owner-${runTag}`,
      {
        headers: { cookie: ownerCookie },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Record<string, unknown>[];
      meta: { total: number };
    };
    expect(body.meta.total).toBe(1);
    const row = body.data[0];
    expect(row?.email).toBe(OWNER_EMAIL);
    expect(row?.role).toBe("owner");
    // serializeRow strips undeclared columns and validates the rest.
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "avatarUrl",
      "createdAt",
      "email",
      "id",
      "name",
      "role",
    ]);
  });

  test("meta shows admins to owners only; list is 403 below owner", async () => {
    const ownerMeta = await app.request("/api/admin/meta/resources", {
      headers: { cookie: ownerCookie },
    });
    const ownerBody = (await ownerMeta.json()) as {
      data: { name: string; permissions: Record<string, string> }[];
    };
    expect(ownerBody.data.map((entry) => entry.name)).toEqual([
      "users",
      "admins",
      "categories",
      "posts",
      "workspaces",
      "mocks",
    ]);
    expect(ownerBody.data.find((entry) => entry.name === "admins")?.permissions).toEqual({
      list: "owner",
      update: "owner",
      delete: "owner",
    });

    const editorMeta = await app.request("/api/admin/meta/resources", {
      headers: { cookie: editorCookie },
    });
    const editorBody = (await editorMeta.json()) as { data: { name: string }[] };
    expect(editorBody.data.map((entry) => entry.name)).toEqual([
      "users",
      "categories",
      "posts",
      "workspaces",
      "mocks",
    ]);

    for (const cookie of [editorCookie, viewerCookie]) {
      const res = await app.request("/api/admin/admins", { headers: { cookie } });
      expect(res.status).toBe(403);
    }
  });

  test("create is not mounted: POST /admin/admins is 404 even for the owner", async () => {
    const res = await app.request("/api/admin/admins", {
      method: "POST",
      headers: mutationHeaders(ownerCookie),
      body: JSON.stringify({ email: "nope@example.com", name: "Nope", role: "owner" }),
    });
    expect(res.status).toBe(404);
  });

  test("empty PATCH is rejected with 400", async () => {
    const res = await app.request(`/api/admin/admins/${editorId}`, {
      method: "PATCH",
      headers: mutationHeaders(ownerCookie),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("role changes take effect on the target's next request", async () => {
    // The editor can create posts...
    const before = await app.request("/api/admin/posts", {
      method: "POST",
      headers: mutationHeaders(editorCookie),
      body: JSON.stringify({ title: `${runTag} pre-demotion`, status: "draft", authorId }),
    });
    expect(before.status).toBe(201);
    const postId = ((await before.json()) as { data: { id: string } }).data.id;

    // ...until the owner demotes them to viewer.
    const patched = await app.request(`/api/admin/admins/${editorId}`, {
      method: "PATCH",
      headers: mutationHeaders(ownerCookie),
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { data: { role: string } }).data.role).toBe("viewer");

    // requireAdmin reads the role fresh per request — no re-login needed.
    const after = await app.request("/api/admin/posts", {
      method: "POST",
      headers: mutationHeaders(editorCookie),
      body: JSON.stringify({ title: `${runTag} post-demotion`, status: "draft", authorId }),
    });
    expect(after.status).toBe(403);

    const cleanup = await app.request(`/api/admin/posts/${postId}`, {
      method: "DELETE",
      headers: mutationHeaders(ownerCookie),
    });
    expect(cleanup.status).toBe(200);
  });

  test("the last owner cannot be demoted or deleted (409)", async () => {
    // The guard counts ALL owner rows, so leftovers from other runs (or a
    // crashed suite) could make this pass spuriously. Files in this suite run
    // sequentially in one process, so temporarily neutralizing other owners
    // is safe; they are restored in the finally.
    const otherOwners = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(and(eq(adminUsers.role, "owner"), ne(adminUsers.id, ownerId)));
    const otherOwnerIds = otherOwners.map((row) => row.id);
    try {
      if (otherOwnerIds.length > 0) {
        await db
          .update(adminUsers)
          .set({ role: "viewer" })
          .where(inArray(adminUsers.id, otherOwnerIds));
      }

      const demote = await app.request(`/api/admin/admins/${ownerId}`, {
        method: "PATCH",
        headers: mutationHeaders(ownerCookie),
        body: JSON.stringify({ role: "editor" }),
      });
      expect(demote.status).toBe(409);
      expect(((await demote.json()) as { error: { code: string } }).error.code).toBe("CONFLICT");

      const del = await app.request(`/api/admin/admins/${ownerId}`, {
        method: "DELETE",
        headers: mutationHeaders(ownerCookie),
      });
      expect(del.status).toBe(409);

      // Promoting (or re-asserting owner) is always allowed.
      const keepOwner = await app.request(`/api/admin/admins/${ownerId}`, {
        method: "PATCH",
        headers: mutationHeaders(ownerCookie),
        body: JSON.stringify({ role: "owner" }),
      });
      expect(keepOwner.status).toBe(200);
    } finally {
      if (otherOwnerIds.length > 0) {
        await db
          .update(adminUsers)
          .set({ role: "owner" })
          .where(inArray(adminUsers.id, otherOwnerIds));
      }
    }
  });

  test("deleting an admin kills their sessions immediately", async () => {
    // The (now viewer) ex-editor still has a valid session...
    const before = await app.request("/api/admin/auth/me", { headers: { cookie: editorCookie } });
    expect(before.status).toBe(200);

    const del = await app.request(`/api/admin/admins/${editorId}`, {
      method: "DELETE",
      headers: mutationHeaders(ownerCookie),
    });
    expect(del.status).toBe(200);

    // Sessions cascade with the row. Note this is "reset, not ban": a Google
    // re-login would recreate them as a fresh viewer.
    const after = await app.request("/api/admin/auth/me", { headers: { cookie: editorCookie } });
    expect(after.status).toBe(401);
  });
});
