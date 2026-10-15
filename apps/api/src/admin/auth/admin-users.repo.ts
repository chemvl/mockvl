import { and, count, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { type AdminUser, adminUsers } from "@/db/schema";

export interface NewAdminUserInput {
  email: string;
  name: string;
  avatarUrl: string | null;
  role?: AdminUser["role"];
}

export interface AdminProfileInput {
  name: string;
  avatarUrl: string | null;
}

export function createAdminUsersRepo(db: Db) {
  return {
    // lower(email) = lower($1) so the case-insensitive unique index is used.
    async findByEmail(email: string): Promise<AdminUser | undefined> {
      const [admin] = await db
        .select()
        .from(adminUsers)
        .where(sql`lower(${adminUsers.email}) = lower(${email})`)
        .limit(1);
      return admin;
    },

    async insert(input: NewAdminUserInput): Promise<AdminUser> {
      const [admin] = await db.insert(adminUsers).values(input).returning();
      if (!admin) throw new Error("admin user insert returned no row");
      return admin;
    },

    // Profile fields track Google on every login; the role never rides along —
    // it only changes through updateRole (seeding now, admin CRUD in 9b).
    async updateProfile(id: string, input: AdminProfileInput): Promise<AdminUser | undefined> {
      const [admin] = await db
        .update(adminUsers)
        .set(input)
        .where(eq(adminUsers.id, id))
        .returning();
      return admin;
    },

    async updateRole(id: string, role: AdminUser["role"]): Promise<AdminUser | undefined> {
      const [admin] = await db
        .update(adminUsers)
        .set({ role })
        .where(eq(adminUsers.id, id))
        .returning();
      return admin;
    },

    // Owners other than `excludingId` — 0 means the excluded admin is the
    // last owner. Backs the admins resource's last-owner lockout guard.
    async countOwners(excludingId: string): Promise<number> {
      const [row] = await db
        .select({ count: count() })
        .from(adminUsers)
        .where(and(eq(adminUsers.role, "owner"), ne(adminUsers.id, excludingId)));
      return row?.count ?? 0;
    },
  };
}

export type AdminUsersRepo = ReturnType<typeof createAdminUsersRepo>;
