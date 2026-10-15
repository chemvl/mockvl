import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { type AdminSession, type AdminUser, adminSessions, adminUsers } from "@/db/schema";

export interface NewAdminSessionInput {
  adminUserId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface AdminSessionWithUser {
  session: AdminSession;
  adminUser: AdminUser;
}

export function createAdminSessionsRepo(db: Db) {
  return {
    async insert(input: NewAdminSessionInput): Promise<AdminSession> {
      const [session] = await db.insert(adminSessions).values(input).returning();
      if (!session) throw new Error("admin session insert returned no row");
      return session;
    },

    // One round-trip per authenticated admin request: session + its user.
    async findWithUserByTokenHash(tokenHash: string): Promise<AdminSessionWithUser | undefined> {
      const [row] = await db
        .select({ session: adminSessions, adminUser: adminUsers })
        .from(adminSessions)
        .innerJoin(adminUsers, eq(adminSessions.adminUserId, adminUsers.id))
        .where(eq(adminSessions.tokenHash, tokenHash))
        .limit(1);
      return row;
    },

    // Sliding expiry: requireAdmin renews when under half the lifetime remains.
    async updateExpiry(id: string, expiresAt: Date): Promise<void> {
      await db.update(adminSessions).set({ expiresAt }).where(eq(adminSessions.id, id));
    },

    async deleteByTokenHash(tokenHash: string): Promise<void> {
      await db.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
    },
  };
}

export type AdminSessionsRepo = ReturnType<typeof createAdminSessionsRepo>;
