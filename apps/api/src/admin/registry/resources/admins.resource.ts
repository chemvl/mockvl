import { AdminUserSchema, AdminUserUpdateSchema, adminUserFields } from "@starter/schemas";
import type { AdminUsersRepo } from "@/admin/auth/admin-users.repo";
import { adminUsers } from "@/db/schema";
import { ConflictError } from "@/lib/errors";
import type { AdminResourceDef } from "../registry";

export interface AdminsResourceDeps {
  // Backs the last-owner guard. Injected (not the shared db singleton) so
  // tests can wire the resource to their own pool or a fake.
  adminUsersRepo: AdminUsersRepo;
}

// Admin role management (deferred 9b follow-up). Owner-only end to end; no
// create — admins enter via the Google-login upsert, never through CRUD.
// The update schema is role-only (profile fields re-sync from Google each
// login), and the hooks below are the first real user of the escape hatch.
// A factory (not a const) because the hooks need a repo — the pattern to copy
// when a generated resource outgrows its static def.
export function createAdminsResource({ adminUsersRepo }: AdminsResourceDeps): AdminResourceDef {
  return {
    name: "admins",
    label: "Admins",
    icon: "SafetyOutlined",
    table: adminUsers,
    schema: { update: AdminUserUpdateSchema, output: AdminUserSchema },
    fields: adminUserFields,
    permissions: { list: "owner", update: "owner", delete: "owner" },
    hooks: {
      // Last-owner lockout guard. Both routes are owner-gated, so
      // countOwners(id) === 0 exactly means the target is the sole owner
      // (any other caller would be counted). Hooks carry no caller identity,
      // so "can't change your own role" is not expressible here — the guard
      // alone is lockout-proof (a lone owner can't demote or delete
      // themselves). Known accepted race: two concurrent demotions of the
      // last two owners can both pass the count; not worth a lock in a
      // starter template.
      beforeUpdate: async (id, input) => {
        if (
          input.role !== undefined &&
          input.role !== "owner" &&
          (await adminUsersRepo.countOwners(id)) === 0
        ) {
          throw new ConflictError("Cannot demote the last owner");
        }
        return input;
      },
      beforeDelete: async (id) => {
        if ((await adminUsersRepo.countOwners(id)) === 0) {
          throw new ConflictError("Cannot delete the last owner");
        }
      },
    },
  };
}
