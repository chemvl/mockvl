import type { AppOpenAPI } from "@/lib/openapi";
import { createRequireWorkspaceMember } from "@/middleware/require-workspace-member";
import { createAuthRoutes } from "@/modules/auth/auth.routes";
import type { AuthService } from "@/modules/auth/auth.service";
import { createMcpRoutes } from "@/modules/mcp/mcp.routes";
import { createMocksRoutes } from "@/modules/mocks/mocks.routes";
import type { MocksService } from "@/modules/mocks/mocks.service";
import { createPersonalAccessTokensRoutes } from "@/modules/personal-access-tokens/personal-access-tokens.routes";
import type { PersonalAccessTokensService } from "@/modules/personal-access-tokens/personal-access-tokens.service";
import { createUsageRoutes } from "@/modules/usage/usage.routes";
import type { UsageService } from "@/modules/usage/usage.service";
import { createUsersRoutes } from "@/modules/users/users.routes";
import type { UsersService } from "@/modules/users/users.service";
import { createInvitesRoutes, createInviteTokenRoutes } from "@/modules/workspaces/invites.routes";
import type { InvitesService } from "@/modules/workspaces/invites.service";
import { createMembersRoutes } from "@/modules/workspaces/members.routes";
import type { MembersService } from "@/modules/workspaces/members.service";
import { createWorkspacesRoutes } from "@/modules/workspaces/workspaces.routes";
import type { WorkspacesService } from "@/modules/workspaces/workspaces.service";

export interface ModuleServices {
  authService: AuthService;
  usersService: UsersService;
  workspacesService: WorkspacesService;
  membersService: MembersService;
  invitesService: InvitesService;
  mocksService: MocksService;
  usageService: UsageService;
  personalAccessTokensService: PersonalAccessTokensService;
}

// The index: one app.route() per public module, mirroring
// admin/registry/resources.ts (admin routes live in admin/mount.ts).
//
// Adding a module (orders, products, ...) is three steps — or one command,
// `bun run module:generate <model>`, which performs all of them:
//   1. Create modules/<name>/{<name>.routes.ts,<name>.service.ts,<name>.repo.ts}.
//   2. Add its service to ModuleServices here and to app.defaults.ts
//      (CreateAppOptions inherits the injection slot via Partial<ModuleServices>).
//   3. Mount it below — app.ts never changes.
export function mountModules(app: AppOpenAPI, services: ModuleServices): void {
  // Referenced by createRoute `security` entries (e.g. GET /users/me).
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });

  app.route("/auth", createAuthRoutes(services.authService));
  app.route("/users", createUsersRoutes(services.usersService));
  // Every /workspaces/{ws}/… route loads the workspace through this guard.
  const requireWorkspaceMember = createRequireWorkspaceMember(services.workspacesService);
  app.route(
    "/workspaces",
    createWorkspacesRoutes(services.workspacesService, requireWorkspaceMember),
  );
  app.route("/workspaces", createMembersRoutes(services.membersService, requireWorkspaceMember));
  app.route("/workspaces", createInvitesRoutes(services.invitesService, requireWorkspaceMember));
  app.route("/invites", createInviteTokenRoutes(services.invitesService));
  app.route("/workspaces", createMocksRoutes(services.mocksService, requireWorkspaceMember));
  app.route(
    "/workspaces",
    createPersonalAccessTokensRoutes(services.personalAccessTokensService, requireWorkspaceMember),
  );
  app.route("/workspaces", createUsageRoutes(services.usageService, requireWorkspaceMember));
  app.route(
    "/mcp",
    createMcpRoutes({
      personalAccessTokensService: services.personalAccessTokensService,
      mocksService: services.mocksService,
    }),
  );
}
