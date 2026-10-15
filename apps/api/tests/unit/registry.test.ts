import "../setup";

import { describe, expect, test } from "bun:test";
import { PostCreateSchema, PostSchema, PostUpdateSchema, postFields } from "@starter/schemas";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { AdminResourceDef } from "@/admin/registry/registry";
import { createAdminRegistry } from "@/admin/registry/registry";
import { posts } from "@/db/schema";

function postsDef(overrides: Partial<AdminResourceDef> = {}): AdminResourceDef {
  return {
    name: "posts",
    label: "Posts",
    icon: "FileTextOutlined",
    table: posts,
    schema: { create: PostCreateSchema, update: PostUpdateSchema, output: PostSchema },
    fields: postFields,
    permissions: { list: "viewer", create: "editor", update: "editor", delete: "owner" },
    ...overrides,
  };
}

describe("createAdminRegistry", () => {
  test("registers a resource and retrieves it by name", () => {
    const registry = createAdminRegistry();
    registry.register(postsDef());
    expect(registry.get("posts")?.label).toBe("Posts");
    expect(registry.list().map((def) => def.name)).toEqual(["posts"]);
  });

  test("rejects a duplicate resource name (boot-time programmer error)", () => {
    const registry = createAdminRegistry();
    registry.register(postsDef());
    expect(() => registry.register(postsDef())).toThrow(/already registered/);
  });

  test("rejects a def whose public half fails ResourceMetaSchema", () => {
    const registry = createAdminRegistry();
    expect(() => registry.register(postsDef({ name: "Not A Slug" }))).toThrow();
  });

  test("rejects a field that is not a column on the table", () => {
    const registry = createAdminRegistry();
    const fields = [{ name: "ghost", type: "string" as const, label: "Ghost" }];
    expect(() => registry.register(postsDef({ fields }))).toThrow(/ghost/);
  });

  test("rejects a field missing from the output schema", () => {
    const registry = createAdminRegistry();
    // `updatedAt` is a real column but pretend the output schema lacks it.
    const output = PostSchema.omit({ createdAt: true });
    expect(() =>
      registry.register(
        postsDef({ schema: { create: PostCreateSchema, update: PostUpdateSchema, output } }),
      ),
    ).toThrow(/createdAt/);
  });

  test("rejects a mutating permission without its request schema", () => {
    const registry = createAdminRegistry();
    // Read-only shape (no create/update schemas) but create is permitted.
    expect(() =>
      registry.register(
        postsDef({
          schema: { output: PostSchema },
          permissions: { list: "viewer", create: "editor" },
        }),
      ),
    ).toThrow(/create/);
  });

  test("accepts a read-only def without create/update schemas", () => {
    const registry = createAdminRegistry();
    registry.register(
      postsDef({ schema: { output: PostSchema }, permissions: { list: "viewer" } }),
    );
    expect(registry.get("posts")).toBeDefined();
  });

  test("rejects a table without an id column (the engine's lookup + tiebreaker key)", () => {
    const registry = createAdminRegistry();
    const noIdTable = pgTable("no_id", {
      key: uuid("key").primaryKey().defaultRandom(),
      title: text("title").notNull(),
    });
    const fields = [{ name: "title", type: "string" as const, label: "Title" }];
    expect(() => registry.register(postsDef({ table: noIdTable, fields }))).toThrow(/id column/);
  });

  test("rejects reserved resource names that collide with mounted admin routes", () => {
    const registry = createAdminRegistry();
    expect(() => registry.register(postsDef({ name: "auth" }))).toThrow(/reserved/);
    expect(() => registry.register(postsDef({ name: "meta" }))).toThrow(/reserved/);
  });

  test("toMeta serializes only the public half (no table, schemas, or hooks)", () => {
    const registry = createAdminRegistry();
    registry.register(postsDef({ hooks: { afterCreate: () => {} } }));
    const meta = registry.toMeta(registry.get("posts") as AdminResourceDef);
    expect(Object.keys(meta).sort()).toEqual(["fields", "icon", "label", "name", "permissions"]);
  });
});
