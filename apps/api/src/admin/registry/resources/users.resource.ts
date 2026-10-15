import { UserAdminSchema, UserSchemaUpdate, userFields } from "@starter/schemas";
import { users } from "@/db/schema";
import type { AdminResourceDef } from "../registry";

// Mostly read-only (PLAN 9b): no create/delete permissions → those routes are
// never mounted, and the output schema (UserAdminSchema) is the wire contract
// — the passwordHash column cannot leak through the generic engine.
export const usersResource: AdminResourceDef = {
  name: "users",
  label: "Users",
  icon: "UserOutlined",
  table: users,
  schema: { update: UserSchemaUpdate, output: UserAdminSchema },
  fields: userFields,
  permissions: { list: "viewer", update: "owner" },
};
