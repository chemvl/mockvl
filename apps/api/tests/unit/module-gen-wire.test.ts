import "../setup";

import { describe, expect, test } from "bun:test";
import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { buildModuleNames } from "../../scripts/module-gen/names";
import {
  appendPublicFields,
  isMounted,
  ModuleWireError,
  wireAppDefaults,
  wireModulesIndex,
} from "../../scripts/module-gen/wire";
import { buildTableModel } from "../../scripts/schema-gen/introspect";

const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
const names = buildModuleNames(buildTableModel("categories", categories));

// Mirrors the real modules/index.ts shape after the composition-root refactor.
const MODULES_INDEX_FIXTURE = `import type { AppOpenAPI } from "@/lib/openapi";
import { createAuthRoutes } from "@/modules/auth/auth.routes";
import type { AuthService } from "@/modules/auth/auth.service";
import { createUsersRoutes } from "@/modules/users/users.routes";
import type { UsersService } from "@/modules/users/users.service";

export interface ModuleServices {
  authService: AuthService;
  usersService: UsersService;
}

export function mountModules(app: AppOpenAPI, services: ModuleServices): void {
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });

  app.route("/auth", createAuthRoutes(services.authService));
  app.route("/users", createUsersRoutes(services.usersService));
}
`;

// Mirrors the real app.defaults.ts shape: nested factory calls inside the
// createDefaultServices return, then the modules resolution block.
const APP_DEFAULTS_FIXTURE = `import { env } from "@/config/env";
import { db } from "@/db/client";
import type { ModuleServices } from "@/modules";
import { createAuthService } from "@/modules/auth/auth.service";
import { createUserRepo } from "@/modules/users/users.repo";
import { createUsersService } from "@/modules/users/users.service";

function createDefaultServices(): ModuleServices {
  const userRepo = createUserRepo(db);
  return {
    authService: createAuthService({
      userRepo,
      jwtSecret: env.JWT_SECRET,
    }),
    usersService: createUsersService({ userRepo }),
  };
}

export function resolveServices(options: ResolveServicesOptions) {
  const defaults = createDefaultServices();
  const modules: ModuleServices = {
    authService: options.authService ?? defaults.authService,
    usersService: options.usersService ?? defaults.usersService,
  };
  return { modules };
}
`;

describe("wireModulesIndex", () => {
  const { source, status } = wireModulesIndex(MODULES_INDEX_FIXTURE, names);

  test("inserts imports, the interface field, and the mount line", () => {
    expect(status).toBe("inserted");
    expect(source).toContain(
      'import { createCategoriesRoutes } from "@/modules/categories/categories.routes";',
    );
    expect(source).toContain(
      'import type { CategoriesService } from "@/modules/categories/categories.service";',
    );
    expect(source).toContain("  categoriesService: CategoriesService;\n}");
    expect(source).toContain(
      '  app.route("/categories", createCategoriesRoutes(services.categoriesService));',
    );
    // Mount lands after the last existing app.route(), inside the function.
    expect(source.indexOf('app.route("/categories"')).toBeGreaterThan(
      source.indexOf('app.route("/users"'),
    );
    expect(source.indexOf('app.route("/categories"')).toBeLessThan(source.lastIndexOf("}"));
  });

  test("is idempotent on a second pass", () => {
    const second = wireModulesIndex(source, names);
    expect(second.status).toBe("already-wired");
    expect(second.source).toBe(source);
    expect(isMounted(source, "categories")).toBe(true);
  });

  test("throws ModuleWireError when the mount anchor is missing", () => {
    const butchered = MODULES_INDEX_FIXTURE.replaceAll("app.route(", "app.mount(");
    expect(() => wireModulesIndex(butchered, names)).toThrow(ModuleWireError);
  });

  test("throws ModuleWireError when the interface anchor is missing", () => {
    const butchered = MODULES_INDEX_FIXTURE.replace(
      "export interface ModuleServices {",
      "export type ModuleServices = {",
    );
    expect(() => wireModulesIndex(butchered, names)).toThrow(ModuleWireError);
  });
});

describe("wireAppDefaults", () => {
  const { source, status } = wireAppDefaults(APP_DEFAULTS_FIXTURE, names);

  test("inserts imports, the default construction, and the resolution line", () => {
    expect(status).toBe("inserted");
    expect(source).toContain(
      'import { createCategoriesRepo } from "@/modules/categories/categories.repo";',
    );
    expect(source).toContain(
      'import { createCategoriesService } from "@/modules/categories/categories.service";',
    );
    expect(source).toContain(
      "    categoriesService: createCategoriesService({ categoriesRepo: createCategoriesRepo(db) }),",
    );
    expect(source).toContain(
      "    categoriesService: options.categoriesService ?? defaults.categoriesService,",
    );
  });

  test("the default lands inside createDefaultServices' return, not the modules block", () => {
    const defaultIdx = source.indexOf("createCategoriesService({ categoriesRepo");
    expect(defaultIdx).toBeGreaterThan(source.indexOf("function createDefaultServices"));
    expect(defaultIdx).toBeLessThan(source.indexOf("export function resolveServices"));
    const resolveIdx = source.indexOf("options.categoriesService ??");
    expect(resolveIdx).toBeGreaterThan(source.indexOf("const modules: ModuleServices = {"));
  });

  test("is idempotent on a second pass", () => {
    const second = wireAppDefaults(source, names);
    expect(second.status).toBe("already-wired");
    expect(second.source).toBe(source);
  });

  test("throws ModuleWireError when createDefaultServices is missing", () => {
    const butchered = APP_DEFAULTS_FIXTURE.replace(
      "function createDefaultServices",
      "function buildDefaults",
    );
    expect(() => wireAppDefaults(butchered, names)).toThrow(ModuleWireError);
  });

  test("throws ModuleWireError when the modules block is missing", () => {
    const butchered = APP_DEFAULTS_FIXTURE.replace(
      "const modules: ModuleServices = {",
      "const services = {",
    );
    expect(() => wireAppDefaults(butchered, names)).toThrow(ModuleWireError);
  });
});

describe("appendPublicFields", () => {
  const MODEL_FIXTURE = `import { z } from "@hono/zod-openapi";
import type { ResourceField } from "./resource";

export const CategorySchema = z.object({}).openapi("Category");

export const categoryFields: ResourceField[] = [];
`;
  const BLOCK = `
// What the PUBLIC categories list endpoint accepts.
export const publicCategoryFields: ResourceField[] = [
  { name: "createdAt", type: "date", label: "Created", sortable: true },
];
`;

  test("appends the block at EOF exactly once", () => {
    const first = appendPublicFields(MODEL_FIXTURE, "publicCategoryFields", BLOCK);
    expect(first.status).toBe("inserted");
    expect(first.source).toContain("export const publicCategoryFields: ResourceField[] = [");
    expect(first.source.endsWith("];\n")).toBe(true);

    const second = appendPublicFields(first.source, "publicCategoryFields", BLOCK);
    expect(second.status).toBe("already-wired");
    expect(second.source).toBe(first.source);
  });
});
