import type { AdminUser, User } from "@starter/schemas";
import type { AdminUser as AdminUserRow } from "@/db/schema";

// Dates cross the wire as ISO strings. Serializing explicitly (instead of
// relying on JSON.stringify's implicit Date conversion) keeps handler return
// types aligned with the response schemas, so drift is a compile error.
export function serializeUser(user: {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}): User {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function serializeAdminUser(admin: AdminUserRow): AdminUser {
  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    avatarUrl: admin.avatarUrl,
    role: admin.role,
    createdAt: admin.createdAt.toISOString(),
  };
}
