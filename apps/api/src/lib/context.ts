import type { Workspace } from "@starter/schemas";
import type { AdminUser } from "@/db/schema";

// Shared Hono environment: variables set by middleware,
// available as `c.get(...)` in every handler.
export type AppEnv = {
  Variables: {
    requestId: string;
    // Only populated on routes behind authMiddleware.
    userId: string;
    // Only populated on routes behind requireAdmin.
    adminUser: AdminUser;
    // Only populated on routes behind requireWorkspaceMember.
    workspace: Workspace;
  };
};
