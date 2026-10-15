import "../setup";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createAdminAuthService } from "@/admin/auth/admin-auth.service";
import { createAdminSessionsRepo } from "@/admin/auth/admin-sessions.repo";
import { createAdminUsersRepo } from "@/admin/auth/admin-users.repo";
import type { GoogleClaims, GoogleOAuth } from "@/admin/auth/google";
import { META_RESOURCES_CACHE_PREFIX } from "@/admin/meta.routes";
import { createCrudRepo } from "@/admin/registry/crud.repo";
import { createCrudService } from "@/admin/registry/crud.service";
import type { AdminResourceDef } from "@/admin/registry/registry";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import { invalidate } from "@/lib/cache";
import { createTestUser } from "../helpers/app-user";
import { createMockyardServices } from "../helpers/mockyard";
import { prepareTestDatabase } from "../helpers/test-db";

// Phase 9b acceptance: Google-mocked login as editor can create and
// update posts but DELETE returns 403; the meta endpoint reflects the role;
// the list endpoint honors the §4.2 page/sort/filter convention. Real stack
// (routes → services → repos) against compose Postgres + Redis; only the
// Google wire calls are faked, at the GoogleOAuth seam.
await prepareTestDatabase();

const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });
const { adminUsers, users } = schema;

const runTag = crypto.randomUUID();
const EDITOR_EMAIL = `phase9b-editor-${runTag}@example.com`;
const OWNER_EMAIL = `phase9b-owner-${runTag}@example.com`;

const petstore = await Bun.file(
  join(import.meta.dir, "../fixtures/schemas/petstore-3.0.yaml"),
).text();
const mockyard = createMockyardServices(db);

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
  // The default registry (posts + read-only users) is the subject under test;
  // services are built on this file's own pool (the shared db singleton gets
  // closed by db.test.ts's afterAll when the whole suite runs).
  crudServiceFactory: (def: AdminResourceDef) =>
    createCrudService({ repo: createCrudRepo(db, def.table), hooks: def.hooks }),
  rateLimit: {
    auth: { windowMs: 60_000, limit: 1_000 },
    global: { windowMs: 60_000, limit: 10_000 },
  },
});

let authorId: string;
let editorCookie: string;
let ownerCookie: string;

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
    .values({ email: `phase9b-author-${runTag}@example.com`, passwordHash: "x" })
    .returning();
  if (!author) throw new Error("author insert failed");
  authorId = author.id;

  // Google-mocked logins: the editor lands as viewer and is promoted (role
  // changes never ride along with login claims); the owner comes from the
  // seed email.
  editorCookie = await login(EDITOR_EMAIL);
  const editor = await adminUsersRepo.findByEmail(EDITOR_EMAIL);
  if (!editor) throw new Error("editor admin missing");
  await adminUsersRepo.updateRole(editor.id, "editor");
  ownerCookie = await login(OWNER_EMAIL);
});

afterAll(async () => {
  // Deleting the author cascades to this run's posts; admin deletions cascade
  // to their sessions.
  await db.delete(users).where(eq(users.id, authorId));
  await db.delete(adminUsers).where(eq(adminUsers.email, EDITOR_EMAIL));
  await db.delete(adminUsers).where(eq(adminUsers.email, OWNER_EMAIL));
  await pool.end({ timeout: 5 });
});

async function createPost(title: string, status: "draft" | "published") {
  const res = await app.request("/api/admin/posts", {
    method: "POST",
    headers: mutationHeaders(editorCookie),
    body: JSON.stringify({ title, status, authorId }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

describe("admin crud e2e (phase 9b acceptance)", () => {
  test("editor can create and update posts, but DELETE returns 403", async () => {
    const id = await createPost(`${runTag} editable`, "draft");

    const patched = await app.request(`/api/admin/posts/${id}`, {
      method: "PATCH",
      headers: mutationHeaders(editorCookie),
      body: JSON.stringify({ status: "published" }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as { data: { status: string; updatedAt: string } };
    expect(patchedBody.data.status).toBe("published");

    const deleted = await app.request(`/api/admin/posts/${id}`, {
      method: "DELETE",
      headers: mutationHeaders(editorCookie),
    });
    expect(deleted.status).toBe(403);
    const deletedBody = (await deleted.json()) as { error: { code: string } };
    expect(deletedBody.error.code).toBe("FORBIDDEN");

    // The row survived the forbidden delete; the owner may remove it.
    const ownerDelete = await app.request(`/api/admin/posts/${id}`, {
      method: "DELETE",
      headers: mutationHeaders(ownerCookie),
    });
    expect(ownerDelete.status).toBe(200);
    expect(
      (await app.request(`/api/admin/posts/${id}`, { headers: { cookie: ownerCookie } })).status,
    ).toBe(404);
  });

  test("meta endpoint reflects the caller's role and carries the registry's public half", async () => {
    const res = await app.request("/api/admin/meta/resources", {
      headers: { cookie: editorCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { name: string; permissions: Record<string, string>; fields: unknown[] }[];
    };
    expect(body.data.map((entry) => entry.name)).toEqual([
      "users",
      "categories",
      "posts",
      "workspaces",
      "mocks",
    ]);
    const posts = body.data.find((entry) => entry.name === "posts");
    expect(posts?.permissions).toEqual({
      list: "viewer",
      create: "editor",
      update: "editor",
      delete: "owner",
    });
    expect(posts?.fields.length).toBeGreaterThan(0);
  });

  test("list endpoint honors the §4.2 page/sort/filter convention", async () => {
    const ids = [
      await createPost(`${runTag} list alpha`, "draft"),
      await createPost(`${runTag} list beta`, "published"),
      await createPost(`${runTag} list gamma`, "published"),
    ];

    // like scopes to this run's rows; filter + sort + pagination compose.
    // createdAt is the def's one sortable field (sorting on title is a 400 by
    // design — the allow-list), so newest-first puts gamma before beta.
    const url =
      `/api/admin/posts?filter[title][like]=${runTag} list` +
      "&filter[status]=published&sort=createdAt:desc&page=1&pageSize=1";
    const res = await app.request(url, { headers: { cookie: editorCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { title: string }[];
      meta: { page: number; pageSize: number; total: number };
    };
    expect(body.meta).toEqual({ page: 1, pageSize: 1, total: 2 });
    expect(body.data.map((row) => row.title)).toEqual([`${runTag} list gamma`]);

    const pageTwo = await app.request(`${url.replace("page=1", "page=2")}`, {
      headers: { cookie: editorCookie },
    });
    const pageTwoBody = (await pageTwo.json()) as { data: { title: string }[] };
    expect(pageTwoBody.data.map((row) => row.title)).toEqual([`${runTag} list beta`]);

    // Cleanup through the API as owner.
    for (const id of ids) {
      const res2 = await app.request(`/api/admin/posts/${id}`, {
        method: "DELETE",
        headers: mutationHeaders(ownerCookie),
      });
      expect(res2.status).toBe(200);
    }
  });

  test("users are read-only: list works, mutations are not mounted, hashes never leak", async () => {
    const list = await app.request(`/api/admin/users?filter[email][like]=${runTag}`, {
      headers: { cookie: editorCookie },
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      data: Record<string, unknown>[];
      meta: { total: number };
    };
    expect(body.meta.total).toBe(1);
    expect(body.data[0]?.email).toBe(`phase9b-author-${runTag}@example.com`);
    expect(body.data[0]?.passwordHash).toBeUndefined();

    const created = await app.request("/api/admin/users", {
      method: "POST",
      headers: mutationHeaders(ownerCookie),
      body: JSON.stringify({ email: "nope@example.com" }),
    });
    expect(created.status).toBe(404);
  });

  test("mockyard workspaces and mocks are listed read-only", async () => {
    const { user } = await createTestUser(db, {
      email: `phase9b-mockyard-${runTag}@example.com`,
    });
    try {
      // First listing provisions the personal workspace.
      const [workspace] = await mockyard.workspacesService.listForUser(user.id);
      if (!workspace) throw new Error("personal workspace was not provisioned");
      const mock = await mockyard.mocksService.create(workspace, user.id, {
        name: "Pets",
        slug: "pets",
        responseMode: "static",
        validateRequests: true,
        cors: true,
        source: { type: "file", filename: "p.yaml", content: petstore },
      });

      const workspacesList = await app.request(
        `/api/admin/workspaces?filter[ownerId][eq]=${user.id}`,
        { headers: { cookie: editorCookie } },
      );
      expect(workspacesList.status).toBe(200);
      const workspacesBody = (await workspacesList.json()) as {
        data: Record<string, unknown>[];
        meta: { total: number };
      };
      expect(workspacesBody.meta.total).toBe(1);
      expect(workspacesBody.data[0]).toMatchObject({
        id: workspace.id,
        slug: workspace.slug,
        ownerId: user.id,
        deletedAt: null,
      });

      const mocksList = await app.request(
        `/api/admin/mocks?filter[workspaceId][eq]=${workspace.id}`,
        { headers: { cookie: editorCookie } },
      );
      expect(mocksList.status).toBe(200);
      const mocksBody = (await mocksList.json()) as {
        data: Record<string, unknown>[];
        meta: { total: number };
      };
      expect(mocksBody.meta.total).toBe(1);
      expect(mocksBody.data[0]).toMatchObject({
        id: mock.id,
        slug: "pets",
        status: "running",
        sourceType: "file",
        createdBy: user.id,
      });
      expect(mocksBody.data[0]).not.toHaveProperty("content");
      expect(mocksBody.data[0]).not.toHaveProperty("operations");

      const one = await app.request(`/api/admin/mocks/${mock.id}`, {
        headers: { cookie: editorCookie },
      });
      expect(one.status).toBe(200);

      // No create/update/delete permissions → those routes are never mounted.
      const patched = await app.request(`/api/admin/mocks/${mock.id}`, {
        method: "PATCH",
        headers: mutationHeaders(ownerCookie),
        body: JSON.stringify({ status: "paused" }),
      });
      expect(patched.status).toBe(404);
      const deleted = await app.request(`/api/admin/workspaces/${workspace.id}`, {
        method: "DELETE",
        headers: mutationHeaders(ownerCookie),
      });
      expect(deleted.status).toBe(404);
      const created = await app.request("/api/admin/mocks", {
        method: "POST",
        headers: mutationHeaders(ownerCookie),
        body: JSON.stringify({}),
      });
      expect(created.status).toBe(404);
    } finally {
      // Cascades: owner_id removes the workspace, its membership, mock and versions.
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
