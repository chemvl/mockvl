import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { type User, users } from "@/db/schema";
import { signAccessToken } from "@/modules/auth/auth.tokens";

// Inserts an app user straight into the table and mints an access token for
// it — e2e suites about workspaces/mocks don't need to go through login.
export async function createTestUser(
  db: Db,
  options: { email?: string; verified?: boolean } = {},
): Promise<{ user: User; accessToken: string }> {
  const { email = `e2e-${crypto.randomUUID()}@example.com`, verified = true } = options;
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: null, emailVerifiedAt: verified ? new Date() : null })
    .returning();
  if (!user) throw new Error("user insert returned no row");
  const accessToken = await signAccessToken({
    sub: user.id,
    secret: env.JWT_SECRET,
    ttlSeconds: 900,
  });
  return { user, accessToken };
}
