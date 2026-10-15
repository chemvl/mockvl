import { z } from "@hono/zod-openapi";
import type { ResourceField } from "./resource";

// Public shape of a user — never carries the password hash.
export const UserSchema = z
  .object({
    id: z.uuid().openapi({ example: "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a" }),
    email: z.email().openapi({ example: "user@example.com" }),
    // Synced from the Google profile on every sign-in; null for password users.
    name: z.string().nullable().openapi({ example: "Jane Doe" }),
    avatarUrl: z.string().nullable().openapi({ example: "https://lh3.googleusercontent.com/a/x" }),
    // Derived from users.email_verified_at (null/not-null); the raw timestamp
    // is deliberately not part of the public shape.
    emailVerified: z.boolean().openapi({ example: true }),
    createdAt: z.iso.datetime().openapi({ example: "2026-07-03T00:00:00.000Z" }),
  })
  .openapi("User");

export const UserSchemaUpdate = z
  .object({
    email: z.email().optional().openapi({ example: "user@example.com" }),
  })
  .openapi("UserUpdate");

// Admin resource shape: the generic CRUD engine reads table columns, so the
// admin (and only the admin) sees the raw timestamp — the public shape above
// derives a boolean from it. Profile fields stay out of the admin contract.
export const UserAdminSchema = UserSchema.omit({ emailVerified: true, name: true, avatarUrl: true })
  .extend({
    emailVerifiedAt: z.iso.datetime().nullable().openapi({ example: "2026-07-03T00:00:00.000Z" }),
  })
  .openapi("UserAdmin");

export type User = z.infer<typeof UserSchema>;
export type UserUpdate = z.infer<typeof UserSchemaUpdate>;

// Users are exposed to the admin as a read-only resource (list/get only), so
// every field is readOnly — no form ever renders for them.
export const userFields: ResourceField[] = [
  {
    name: "email",
    type: "string",
    label: "Email",
    listColumn: true,
    searchable: true,
  },
  // The column, not the derived boolean — registry fields must be
  // table-backed. Null means unverified; sort by it to surface those rows.
  {
    name: "emailVerifiedAt",
    type: "date",
    label: "Verified at",
    listColumn: true,
    sortable: true,
    filterable: true,
    readOnly: true,
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
