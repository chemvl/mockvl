import { z } from "@hono/zod-openapi";
// Type-only: resource.ts imports AdminRoleSchema from this file, so a value
// import here would create a runtime cycle (same pattern as post.ts).
import type { ResourceField } from "./resource";

// Ordered lowest to highest; requireAdmin(minRole) compares by index.
export const ADMIN_ROLES = ["viewer", "editor", "owner"] as const;

export const AdminRoleSchema = z.enum(ADMIN_ROLES).openapi("AdminRole");
export type AdminRole = z.infer<typeof AdminRoleSchema>;

// Public shape of an admin user — session/token material never appears here.
export const AdminUserSchema = z
  .object({
    id: z.uuid().openapi({ example: "9c1d3f7a-2b4e-4c6d-8e0f-1a2b3c4d5e6f" }),
    email: z.email().openapi({ example: "admin@company.com" }),
    name: z.string().openapi({ example: "Ada Lovelace" }),
    avatarUrl: z.url().nullable().openapi({ example: "https://lh3.googleusercontent.com/a/photo" }),
    role: AdminRoleSchema,
    createdAt: z.iso.datetime().openapi({ example: "2026-07-06T00:00:00.000Z" }),
  })
  .openapi("AdminUser");

export type AdminUser = z.infer<typeof AdminUserSchema>;

// Role is the entire admin-CRUD update surface: profile fields track Google
// on every login and email is the identity — unknown keys are stripped, so a
// hand-crafted PATCH can't reach them (it validates down to an empty patch,
// which the crud service rejects with a 400).
export const AdminUserUpdateSchema = z
  .object({ role: AdminRoleSchema })
  .partial()
  .openapi("AdminUserUpdate");

export type AdminUserUpdate = z.infer<typeof AdminUserUpdateSchema>;

// Drives the generic admin list/form rendering. Everything except role is
// readOnly (disabled on the edit form and stripped from the PATCH payload);
// role is required so the enum Select can't be cleared into an empty patch.
// avatarUrl renders via the "image" field type (avatar in the list); it stays
// readOnly because profile fields track Google on every login.
export const adminUserFields: ResourceField[] = [
  {
    name: "avatarUrl",
    type: "image",
    label: "Avatar",
    listColumn: true,
    readOnly: true,
  },
  {
    name: "email",
    type: "string",
    label: "Email",
    listColumn: true,
    searchable: true,
    readOnly: true,
  },
  {
    name: "name",
    type: "string",
    label: "Name",
    listColumn: true,
    searchable: true,
    readOnly: true,
  },
  {
    name: "role",
    type: "enum",
    label: "Role",
    options: [...ADMIN_ROLES],
    required: true,
    listColumn: true,
    filterable: true,
  },
  {
    name: "createdAt",
    type: "date",
    label: "Created",
    listColumn: true,
    sortable: true,
    readOnly: true,
  },
];
