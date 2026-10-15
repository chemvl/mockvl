import "../setup";

import { describe, expect, test } from "bun:test";
import {
  ADMIN_ROLES,
  AdminUserSchema,
  AdminUserUpdateSchema,
  adminUserFields,
  ResourceFieldSchema,
} from "@starter/schemas";

describe("admin-user schemas", () => {
  test("AdminUserUpdateSchema accepts a role change", () => {
    const parsed = AdminUserUpdateSchema.parse({ role: "editor" });
    expect(parsed).toEqual({ role: "editor" });
  });

  test("AdminUserUpdateSchema rejects an unknown role", () => {
    expect(() => AdminUserUpdateSchema.parse({ role: "superuser" })).toThrow();
  });

  test("AdminUserUpdateSchema strips non-role keys (role is the whole update surface)", () => {
    // Profile fields track Google on every login; a hand-crafted PATCH cannot
    // reach them through this schema — it validates down to an empty patch,
    // which the crud service then rejects with a 400.
    const parsed = AdminUserUpdateSchema.parse({ name: "Mallory", email: "m@evil.com" });
    expect(parsed).toEqual({});
  });

  test("AdminUserUpdateSchema accepts an empty object (service layer rejects empty patches)", () => {
    expect(AdminUserUpdateSchema.parse({})).toEqual({});
  });
});

describe("adminUserFields metadata (no-drift rule: fields live beside their Zod schema)", () => {
  test("fields are valid ResourceFields and name only AdminUserSchema properties", () => {
    const outputKeys = Object.keys(AdminUserSchema.shape);
    for (const field of adminUserFields) {
      ResourceFieldSchema.parse(field);
      expect(outputKeys).toContain(field.name);
    }
  });

  test("role is the only editable field and carries every admin role option", () => {
    const byName = new Map(adminUserFields.map((field) => [field.name, field]));
    expect(byName.get("role")).toMatchObject({
      type: "enum",
      options: [...ADMIN_ROLES],
      required: true,
      listColumn: true,
      filterable: true,
    });
    // Everything except role is readOnly — the edit form renders them
    // disabled and strips them from the PATCH payload.
    for (const field of adminUserFields) {
      if (field.name !== "role") expect(field.readOnly).toBe(true);
    }
  });

  test("identity and audit columns are present for the list page", () => {
    const byName = new Map(adminUserFields.map((field) => [field.name, field]));
    expect(byName.get("avatarUrl")).toMatchObject({
      type: "image",
      listColumn: true,
      readOnly: true,
    });
    expect(byName.get("email")).toMatchObject({
      type: "string",
      listColumn: true,
      searchable: true,
    });
    expect(byName.get("name")).toMatchObject({
      type: "string",
      listColumn: true,
      searchable: true,
    });
    expect(byName.get("createdAt")).toMatchObject({ type: "date", sortable: true, readOnly: true });
  });
});
