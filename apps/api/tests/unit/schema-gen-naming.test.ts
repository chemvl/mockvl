import "../setup";

import { describe, expect, test } from "bun:test";
import {
  camelCase,
  constantCase,
  kebabCase,
  normalizeModelArg,
  pascalCase,
  pluralize,
  singularize,
  titleCase,
} from "../../scripts/schema-gen/naming";

describe("singularize", () => {
  test.each([
    ["categories", "category"],
    ["companies", "company"],
    ["posts", "post"],
    ["users", "user"],
    ["statuses", "status"],
    ["addresses", "address"],
    ["adminUsers", "adminUser"],
    ["address", "address"], // trailing "ss" is not a plural
    ["category", "category"], // already singular
  ])("%s → %s", (input, expected) => {
    expect(singularize(input)).toBe(expected);
  });
});

describe("pluralize", () => {
  test.each([
    ["category", "categories"],
    ["status", "statuses"],
    ["post", "posts"],
    ["box", "boxes"],
    ["branch", "branches"],
    ["day", "days"], // vowel before y keeps the y
    ["post_status", "post_statuses"], // suffix-based, works on identifiers
  ])("%s → %s", (input, expected) => {
    expect(pluralize(input)).toBe(expected);
  });
});

describe("case transforms", () => {
  test("pascalCase handles snake, kebab, and camel input", () => {
    expect(pascalCase("admin_users")).toBe("AdminUsers");
    expect(pascalCase("admin-user")).toBe("AdminUser");
    expect(pascalCase("adminUser")).toBe("AdminUser");
  });

  test("camelCase", () => {
    expect(camelCase("admin_users")).toBe("adminUsers");
    expect(camelCase("post")).toBe("post");
  });

  test("kebabCase", () => {
    expect(kebabCase("adminUsers")).toBe("admin-users");
    expect(kebabCase("admin_users")).toBe("admin-users");
  });

  test("constantCase", () => {
    expect(constantCase("post_statuses")).toBe("POST_STATUSES");
    expect(constantCase("adminRoles")).toBe("ADMIN_ROLES");
  });

  test("titleCase", () => {
    expect(titleCase("authorId")).toBe("Author Id");
    expect(titleCase("createdAt")).toBe("Created At");
    expect(titleCase("name")).toBe("Name");
  });
});

describe("normalizeModelArg", () => {
  test("is case- and punctuation-insensitive", () => {
    expect(normalizeModelArg("Admin-Users")).toBe("adminusers");
    expect(normalizeModelArg("admin_users")).toBe("adminusers");
    expect(normalizeModelArg("adminUsers")).toBe("adminusers");
  });
});
