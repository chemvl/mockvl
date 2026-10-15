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
import { createAdminRegistry } from "@/admin/registry/registry";
import { createApp } from "@/app";
import { env } from "@/config/env";
import type { AdminUser } from "@/db/schema";
import { posts, users } from "@/db/schema";
import type { CachedFn } from "@/lib/cache";

function fakeAdminAuthService(role: AdminUser["role"]): AdminAuthService {
  return {
    validateSession: async () => ({
      adminUser: {
        id: crypto.randomUUID(),
        email: "ada@example.com",
        name: "Ada",
        avatarUrl: null,
        role,
        createdAt: new Date(),
      },
      expiresAt: new Date(Date.now() + 60_000),
      renewed: false,
    }),
  } as unknown as AdminAuthService;
}

function makeRegistry() {
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
  // Owner-only listing — invisible to viewers/editors in the meta payload.
  registry.register({
    name: "audits",
    label: "Audits",
    table: users,
    schema: { output: UserAdminSchema },
    fields: userFields,
    permissions: { list: "owner" },
  });
  return registry;
}

interface CacheCall {
  key: string;
  ttlS: number;
}

function recordingCache(): { cachedFn: CachedFn; calls: CacheCall[] } {
  const calls: CacheCall[] = [];
  return {
    calls,
    cachedFn: (key, ttlS, fn) => {
      calls.push({ key, ttlS });
      return fn();
    },
  };
}

function makeApp(role: AdminUser["role"]) {
  const cache = recordingCache();
  const app = createApp({
    adminAuthService: fakeAdminAuthService(role),
    adminRegistry: makeRegistry(),
    metaCachedFn: cache.cachedFn,
  });
  return { app, cache };
}

const SESSION = { cookie: "admin_session=raw-token" };

describe("GET /admin/meta/resources", () => {
  test("returns only resources the caller's role can list", async () => {
    const { app } = makeApp("viewer");
    const res = await app.request("/api/admin/meta/resources", { headers: SESSION });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string }[] };
    expect(body.data.map((entry) => entry.name)).toEqual(["posts"]);
  });

  test("an owner sees every resource", async () => {
    const { app } = makeApp("owner");
    const res = await app.request("/api/admin/meta/resources", { headers: SESSION });
    const body = (await res.json()) as { data: { name: string }[] };
    expect(body.data.map((entry) => entry.name)).toEqual(["posts", "audits"]);
  });

  test("entries carry exactly the public halves — no Drizzle internals", async () => {
    const { app } = makeApp("owner");
    const res = await app.request("/api/admin/meta/resources", { headers: SESSION });
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    const entry = body.data[0] as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual(["fields", "icon", "label", "name", "permissions"]);
    expect(entry.permissions).toEqual({
      list: "viewer",
      create: "editor",
      update: "editor",
      delete: "owner",
    });
  });

  test("requires an admin session", async () => {
    const { app } = makeApp("viewer");
    const res = await app.request("/api/admin/meta/resources");
    expect(res.status).toBe(401);
  });

  test("payload is served through cached() keyed per role with the default TTL", async () => {
    const { app, cache } = makeApp("editor");
    await app.request("/api/admin/meta/resources", { headers: SESSION });
    expect(cache.calls).toEqual([
      { key: "cache:admin:meta:resources:editor", ttlS: env.CACHE_DEFAULT_TTL_S },
    ]);
  });
});
