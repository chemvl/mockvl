import "../setup";

import { describe, expect, test } from "bun:test";
import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { buildTableModel } from "../../scripts/schema-gen/introspect";
import {
  buildResourceModule,
  insertRegisterCall,
  isRegistered,
  RegistryEditError,
  registerResource,
  upsertResourceImport,
} from "../../scripts/schema-gen/register";
import { categories } from "../../src/db/schema";

// Mirrors the real resources.ts shape: an index with one import + one
// register() call per resource (one under a hand-picked name, via a factory)
// before `return registry;`.
const INDEX_FIXTURE = `import type { AdminUsersRepo } from "@/admin/auth/admin-users.repo";
import { type AdminRegistry, createAdminRegistry } from "./registry";
import { createAdminsResource } from "./resources/admins.resource";
import { postsResource } from "./resources/posts.resource";

export function createDefaultAdminRegistry(): AdminRegistry {
  const registry = createAdminRegistry();

  registry.register(postsResource);
  registry.register(createAdminsResource({ adminUsersRepo }));

  return registry;
}
`;

// Mirrors the concatenated contents of the existing resources/*.resource.ts
// files — the defs (and their name:/table: lines) live here, not in the index.
const RESOURCE_FIXTURES = `import { PostCreateSchema, PostSchema, PostUpdateSchema, postFields } from "@starter/schemas";
import { posts } from "@/db/schema";
import type { AdminResourceDef } from "../registry";

export const postsResource: AdminResourceDef = {
  name: "posts",
  label: "Posts",
  table: posts,
  schema: { create: PostCreateSchema, update: PostUpdateSchema, output: PostSchema },
  fields: postFields,
  permissions: { list: "viewer" },
};

import { AdminUserSchema, adminUserFields } from "@starter/schemas";
import { adminUsers } from "@/db/schema";

export function createAdminsResource({ adminUsersRepo }) {
  return {
    name: "admins",
    label: "Admins",
    table: adminUsers,
    schema: { output: AdminUserSchema },
    fields: adminUserFields,
    permissions: { list: "owner" },
  };
}
`;

const DEDUP_CORPUS = `${INDEX_FIXTURE}\n${RESOURCE_FIXTURES}`;

describe("isRegistered", () => {
  test("detects a resource by its registered name", () => {
    expect(isRegistered(DEDUP_CORPUS, "posts", "posts")).toBe(true);
  });

  test("detects a table registered under a hand-picked name", () => {
    // adminUsers ships as "admins" — the mechanical slug would be "admin-users".
    expect(isRegistered(DEDUP_CORPUS, "admin-users", "adminUsers")).toBe(true);
  });

  test("returns false for an unknown resource", () => {
    expect(isRegistered(DEDUP_CORPUS, "categories", "categories")).toBe(false);
  });

  test("does not false-positive on identifier prefixes", () => {
    // `table: adminUsers` must not match a lookup for the `users` table.
    expect(isRegistered(DEDUP_CORPUS, "users", "users")).toBe(false);
  });
});

describe("upsertResourceImport", () => {
  test("appends the import after the last top-level import", () => {
    const result = upsertResourceImport(
      INDEX_FIXTURE,
      "categoriesResource",
      "./resources/categories.resource",
    );
    expect(result).toContain(
      'import { categoriesResource } from "./resources/categories.resource";',
    );
    // Lands between the imports and the function, not at the top.
    expect(result.indexOf("categoriesResource")).toBeGreaterThan(
      result.indexOf("./resources/posts.resource"),
    );
    expect(result.indexOf("categoriesResource")).toBeLessThan(
      result.indexOf("createDefaultAdminRegistry"),
    );
  });

  test("is idempotent when the module is already imported", () => {
    const once = upsertResourceImport(
      INDEX_FIXTURE,
      "categoriesResource",
      "./resources/categories.resource",
    );
    expect(
      upsertResourceImport(once, "categoriesResource", "./resources/categories.resource"),
    ).toBe(once);
  });

  test("throws RegistryEditError when the source has no imports", () => {
    expect(() =>
      upsertResourceImport("export const x = 1;\n", "categoriesResource", "./x"),
    ).toThrow(RegistryEditError);
  });
});

describe("insertRegisterCall", () => {
  test("splices the block onto its own line right before `return registry;`", () => {
    const result = insertRegisterCall(INDEX_FIXTURE, "  // NEW BLOCK");
    expect(result).toContain("  // NEW BLOCK\n\n  return registry;");
    // Everything before the insertion point is untouched.
    expect(
      result.startsWith(INDEX_FIXTURE.slice(0, INDEX_FIXTURE.indexOf("  return registry;"))),
    ).toBe(true);
  });

  test("throws when createDefaultAdminRegistry is missing", () => {
    expect(() => insertRegisterCall("return registry;", "  // X")).toThrow(RegistryEditError);
  });

  test("throws when `return registry;` is missing or precedes the function", () => {
    expect(() => insertRegisterCall("createDefaultAdminRegistry() {}", "  // X")).toThrow(
      RegistryEditError,
    );
    expect(() =>
      insertRegisterCall("return registry;\ncreateDefaultAdminRegistry() {}", "  // X"),
    ).toThrow(RegistryEditError);
  });
});

describe("buildResourceModule", () => {
  test("emits the full-CRUD default module for categories", () => {
    const module = buildResourceModule(buildTableModel("categories", categories));
    expect(module.resourceName).toBe("categories");
    expect(module.constName).toBe("categoriesResource");
    expect(module.fileName).toBe("categories.resource.ts");
    expect(
      module.contents,
    ).toBe(`// Generated scaffold — a static def. Convert to a factory taking deps as
// params if the resource ever needs them (see admins.resource.ts).
import {
  CategoryCreateSchema,
  CategorySchema,
  CategoryUpdateSchema,
  categoryFields,
} from "@starter/schemas";
import { categories } from "@/db/schema";
import type { AdminResourceDef } from "../registry";

export const categoriesResource: AdminResourceDef = {
  name: "categories",
  label: "Categories",
  // TODO(generator): pick a real antd icon name.
  icon: "TableOutlined",
  table: categories,
  schema: {
    create: CategoryCreateSchema,
    update: CategoryUpdateSchema,
    output: CategorySchema,
  },
  fields: categoryFields,
  // TODO(generator): review permissions before shipping.
  permissions: { list: "viewer", create: "editor", update: "editor", delete: "owner" },
};
`);
  });

  test("read-only shape (no create columns) skips Create/Update everywhere", () => {
    const auditLogs = pgTable("audit_logs", {
      id: uuid("id").primaryKey().defaultRandom(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    });
    const module = buildResourceModule(buildTableModel("auditLogs", auditLogs));
    expect(module.resourceName).toBe("audit-logs");
    expect(module.constName).toBe("auditLogsResource");
    expect(module.fileName).toBe("audit-logs.resource.ts");
    expect(module.contents).toContain("schema: { output: AuditLogSchema },");
    expect(module.contents).toContain('permissions: { list: "viewer" },');
    expect(module.contents).not.toContain("Create");
    expect(module.contents).not.toContain("Update");
  });
});

describe("registerResource", () => {
  test("emits the resource file and wires the index for a new model", () => {
    const model = buildTableModel("categories", categories);
    const result = registerResource(INDEX_FIXTURE, RESOURCE_FIXTURES, model);
    expect(result.status).toBe("inserted");
    expect(result.resourceName).toBe("categories");
    expect(result.resourceFile?.fileName).toBe("categories.resource.ts");
    expect(result.resourceFile?.contents).toContain('name: "categories",');
    expect(result.indexSource).toContain(
      'import { categoriesResource } from "./resources/categories.resource";',
    );
    expect(result.indexSource).toContain("  registry.register(categoriesResource);");
    expect(result.indexSource.indexOf("registry.register(categoriesResource);")).toBeLessThan(
      result.indexSource.indexOf("return registry;"),
    );
  });

  test("is a no-op skip when the resource is already registered", () => {
    const model = buildTableModel("categories", categories);
    const first = registerResource(INDEX_FIXTURE, RESOURCE_FIXTURES, model);
    // The driver appends new file contents to the corpus between calls.
    const corpus = `${RESOURCE_FIXTURES}\n${first.resourceFile?.contents}`;
    const second = registerResource(first.indexSource, corpus, model);
    expect(second.status).toBe("already-registered");
    expect(second.indexSource).toBe(first.indexSource);
    expect(second.resourceFile).toBeUndefined();
  });

  test("skips when the def exists in a resource file even if unwired", () => {
    // The index knows nothing about posts, but posts.resource.ts does.
    const bareIndex = INDEX_FIXTURE.replace("  registry.register(postsResource);\n", "").replace(
      'import { postsResource } from "./resources/posts.resource";\n',
      "",
    );
    const model = buildTableModel("posts", categories); // table irrelevant — name matches
    const result = registerResource(bareIndex, RESOURCE_FIXTURES, model);
    expect(result.status).toBe("already-registered");
  });

  test("rejects reserved resource names before touching the source", () => {
    const meta = pgTable("meta", {
      id: uuid("id").primaryKey().defaultRandom(),
    });
    expect(() =>
      registerResource(INDEX_FIXTURE, RESOURCE_FIXTURES, buildTableModel("meta", meta)),
    ).toThrow(RegistryEditError);
  });
});
