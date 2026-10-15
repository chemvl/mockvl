import type { WorkspaceRole } from "@starter/schemas";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "@/lib/context";
import { ForbiddenError } from "@/lib/errors";
import { NO_PERMISSION } from "@/modules/workspaces/workspaces.errors";

// Runs after requireWorkspaceMember: 403 FORBIDDEN unless the caller's role in
// c.get("workspace") is one of `roles`.
export function requireWorkspaceRole(roles: readonly WorkspaceRole[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!roles.includes(c.get("workspace").role)) throw new ForbiddenError(NO_PERMISSION);
    await next();
  };
}
