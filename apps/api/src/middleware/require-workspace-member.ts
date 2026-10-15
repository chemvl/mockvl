import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import type { WorkspacesService } from "@/modules/workspaces/workspaces.service";

export type RequireWorkspaceMember = MiddlewareHandler<AppEnv>;

// Runs after authMiddleware on every /workspaces/{ws}/… route: loads the
// workspace named by the `ws` path param for the caller (404 NOT_FOUND when it
// is missing or the caller is not a member), applies the
// APP_GOOGLE_ALLOWED_HD rule, and exposes it as c.get("workspace").
export function createRequireWorkspaceMember(
  service: Pick<WorkspacesService, "requireMembership">,
): RequireWorkspaceMember {
  return async (c, next) => {
    const slug = c.req.param("ws");
    if (!slug) throw new NotFoundError("Workspace not found");
    c.set("workspace", await service.requireMembership(c.get("userId"), slug));
    await next();
  };
}
