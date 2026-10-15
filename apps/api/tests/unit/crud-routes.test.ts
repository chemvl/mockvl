import "../setup";
import { describe, expect, test } from "bun:test";
import {
  PostCreateSchema,
  PostSchema,
  PostUpdateSchema,
  postFields,
  UserAdminSchema,
  userFields,
} from "@starter/schemas";
import type { AdminAuthService } from "@/admin/auth/admin-auth.service";
import type { CrudService } from "@/admin/registry/crud.service";
import { createAdminRegistry } from "@/admin/registry/registry";
import { createApp } from "@/app";
import type { AdminUser } from "@/db/schema";
import { posts, users } from "@/db/schema";
import type { ListQuery } from "@/lib/pagination";

const POST_ID = "9c1d3f7a-2b4e-4c6d-8e0f-1a2b3c4d5e6f";
const AUTHOR_ID = "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a";

// A row as the repo would return it: Dates, plus a column that must never
// reach the wire because it is not part of the output schema.
const postRow = {
  id: POST_ID,
  title: "Hello",
  status: "draft",
  content: null,
  coverImageUrl: null,
  categoryId: null,
  authorId: AUTHOR_ID,
  createdAt: new Date("2026-07-06T00:00:00.000Z"),
  updatedAt: new Date("2026-07-06T00:00:00.000Z"),
  secretColumn: "must-not-leak",
};

function admin(role: AdminUser["role"]): AdminUser {
  return {
    id: crypto.randomUUID(),
    email: "ada@example.com",
    name: "Ada",
    avatarUrl: null,
    role,
    createdAt: new Date(),
  };
}

function fakeAdminAuthService(role: AdminUser["role"]): AdminAuthService {
  return {
    validateSession: async () => ({
      adminUser: admin(role),
      expiresAt: new Date(Date.now() + 60_000),
      renewed: false,
    }),
  } as unknown as AdminAuthService;
}

interface Recorded {
  calls: { method: string; args: unknown[] }[];
}

function fakeCrudService(): CrudService & Recorded {
  const calls: Recorded["calls"] = [];
  return {
    calls,
    list: async (query: ListQuery) => {
      calls.push({ method: "list", args: [query] });
      return { rows: [postRow], total: 1 };
    },
    get: async (id: string) => {
      calls.push({ method: "get", args: [id] });
      return postRow;
    },
    create: async (input: Record<string, unknown>) => {
      calls.push({ method: "create", args: [input] });
      return { ...postRow, ...input };
    },
    update: async (id: string, input: Record<string, unknown>) => {
      calls.push({ method: "update", args: [id, input] });
      return { ...postRow, ...input };
    },
    remove: async (id: string) => {
      calls.push({ method: "remove", args: [id] });
      return postRow;
    },
  };
}

const userRow = {
  id: AUTHOR_ID,
  email: "user@example.com",
  passwordHash: "must-not-leak",
  emailVerifiedAt: null,
  createdAt: new Date("2026-07-06T00:00:00.000Z"),
  updatedAt: new Date("2026-07-06T00:00:00.000Z"),
};

function fakeUsersCrudService(): CrudService {
  return {
    list: async () => ({ rows: [userRow], total: 1 }),
    get: async () => userRow,
    create: async (input: Record<string, unknown>) => ({ ...userRow, ...input }),
    update: async (_id: string, input: Record<string, unknown>) => ({ ...userRow, ...input }),
    remove: async () => userRow,
  };
}

function makeApp(role: AdminUser["role"]) {
  const registry = createAdminRegistry();
  registry.register({
    name: "posts",
    label: "Posts",
    icon: "FileTextOutlined",
    table: posts,
    schema: { create: PostCreateSchema, update: PostUpdateSchema, output: PostSchema },
    fields: postFields,
    permissions: { list: "viewer", create: "editor", update: "editor", delete: "owner" },
  });
  registry.register({
    name: "users",
    label: "Users",
    icon: "UserOutlined",
    table: users,
    schema: { output: UserAdminSchema },
    fields: userFields,
    permissions: { list: "viewer" },
  });
  const service = fakeCrudService();
  const usersService = fakeUsersCrudService();
  const app = createApp({
    adminAuthService: fakeAdminAuthService(role),
    adminRegistry: registry,
    crudServiceFactory: (def) => (def.name === "users" ? usersService : service),
  });
  return { app, service };
}

const SESSION = { cookie: "admin_session=raw-token" };
const MUTATION_HEADERS = {
  ...SESSION,
  "x-requested-with": "XMLHttpRequest",
  "content-type": "application/json",
};

describe("GET /admin/posts (list)", () => {
  test("returns serialized rows in the list envelope with meta", async () => {
    const { app } = makeApp("viewer");
    const res = await app.request("/api/admin/posts?page=2&pageSize=5", { headers: SESSION });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Record<string, unknown>[];
      meta: Record<string, unknown>;
    };
    expect(body.meta).toEqual({ page: 2, pageSize: 5, total: 1 });
    expect(body.data[0]?.createdAt).toBe("2026-07-06T00:00:00.000Z");
    // Not in the output schema → stripped, never on the wire.
    expect(body.data[0]?.secretColumn).toBeUndefined();
  });

  test("passes the parsed list query to the service", async () => {
    const { app, service } = makeApp("viewer");
    await app.request("/api/admin/posts?sort=createdAt:desc&filter[status]=published", {
      headers: SESSION,
    });
    expect(service.calls[0]?.args[0]).toEqual({
      page: 1,
      pageSize: 20,
      sort: [{ field: "createdAt", dir: "desc" }],
      filters: [{ field: "status", op: "eq", value: "published" }],
    });
  });

  test("rejects an undeclared filter field with the 400 envelope", async () => {
    const { app } = makeApp("viewer");
    const res = await app.request("/api/admin/posts?filter[secretColumn]=x", { headers: SESSION });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("requires an admin session", async () => {
    const { app } = makeApp("viewer");
    const res = await app.request("/api/admin/posts");
    expect(res.status).toBe(401);
  });
});

describe("POST /admin/posts (create)", () => {
  test("editor can create; body is validated and defaults applied", async () => {
    const { app, service } = makeApp("editor");
    const res = await app.request("/api/admin/posts", {
      method: "POST",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({ title: "New", authorId: AUTHOR_ID }),
    });
    expect(res.status).toBe(201);
    expect(service.calls[0]?.args[0]).toEqual({
      title: "New",
      authorId: AUTHOR_ID,
      status: "draft",
      content: null,
      coverImageUrl: null,
      categoryId: null,
    });
  });

  test("viewer gets 403", async () => {
    const { app, service } = makeApp("viewer");
    const res = await app.request("/api/admin/posts", {
      method: "POST",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({ title: "New", authorId: AUTHOR_ID }),
    });
    expect(res.status).toBe(403);
    expect(service.calls).toHaveLength(0);
  });

  test("a wrong-shaped body returns the 400 envelope", async () => {
    const { app } = makeApp("editor");
    const res = await app.request("/api/admin/posts", {
      method: "POST",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({ authorId: AUTHOR_ID }),
    });
    expect(res.status).toBe(400);
  });

  test("mutations without X-Requested-With are blocked (CSRF)", async () => {
    const { app, service } = makeApp("editor");
    const res = await app.request("/api/admin/posts", {
      method: "POST",
      headers: { ...SESSION, "content-type": "application/json" },
      body: JSON.stringify({ title: "New", authorId: AUTHOR_ID }),
    });
    expect(res.status).toBe(403);
    expect(service.calls).toHaveLength(0);
  });
});

describe("item routes", () => {
  test("GET /admin/posts/:id returns the serialized row", async () => {
    const { app } = makeApp("viewer");
    const res = await app.request(`/api/admin/posts/${POST_ID}`, { headers: SESSION });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.id).toBe(POST_ID);
    expect(body.data.secretColumn).toBeUndefined();
  });

  test("a non-uuid id is rejected with 400", async () => {
    const { app } = makeApp("viewer");
    const res = await app.request("/api/admin/posts/not-a-uuid", { headers: SESSION });
    expect(res.status).toBe(400);
  });

  test("PATCH /admin/posts/:id as editor updates", async () => {
    const { app, service } = makeApp("editor");
    const res = await app.request(`/api/admin/posts/${POST_ID}`, {
      method: "PATCH",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({ status: "published" }),
    });
    expect(res.status).toBe(200);
    expect(service.calls[0]?.args).toEqual([POST_ID, { status: "published" }]);
  });

  test("DELETE /admin/posts/:id requires owner (editor gets 403)", async () => {
    const editor = makeApp("editor");
    const forbidden = await editor.app.request(`/api/admin/posts/${POST_ID}`, {
      method: "DELETE",
      headers: MUTATION_HEADERS,
    });
    expect(forbidden.status).toBe(403);

    const owner = makeApp("owner");
    const deleted = await owner.app.request(`/api/admin/posts/${POST_ID}`, {
      method: "DELETE",
      headers: MUTATION_HEADERS,
    });
    expect(deleted.status).toBe(200);
    expect(owner.service.calls[0]?.method).toBe("remove");
  });
});

describe("read-only resources (users)", () => {
  test("list works for a viewer and never leaks undeclared columns", async () => {
    const { app } = makeApp("viewer");
    const res = await app.request("/api/admin/users", { headers: SESSION });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    expect(body.data[0]?.email).toBe("user@example.com");
    expect(body.data[0]?.passwordHash).toBeUndefined();
  });

  test("mutating routes are not mounted → 404 even for an owner", async () => {
    const { app, service } = makeApp("owner");
    const created = await app.request("/api/admin/users", {
      method: "POST",
      headers: MUTATION_HEADERS,
      body: JSON.stringify({ email: "x@example.com" }),
    });
    expect(created.status).toBe(404);

    const deleted = await app.request(`/api/admin/users/${POST_ID}`, {
      method: "DELETE",
      headers: MUTATION_HEADERS,
    });
    expect(deleted.status).toBe(404);
    expect(service.calls).toHaveLength(0);
  });
});
