import { type AdminAuthService, createAdminAuthService } from "@/admin/auth/admin-auth.service";
import { createAdminSessionsRepo } from "@/admin/auth/admin-sessions.repo";
import { createAdminUsersRepo } from "@/admin/auth/admin-users.repo";
import { createGoogleOAuth } from "@/admin/auth/google";
import {
  type AdminNotificationsService,
  createAdminNotificationsService,
} from "@/admin/notifications/admin-notifications.service";
import { createCrudRepo } from "@/admin/registry/crud.repo";
import { type CrudService, createCrudService } from "@/admin/registry/crud.service";
import type { AdminRegistry, AdminResourceDef } from "@/admin/registry/registry";
import { createDefaultAdminRegistry } from "@/admin/registry/resources";
import { createPushSender } from "@/clients/fcm";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { cancelJob, enqueue } from "@/jobs/boss";
import { invalidate } from "@/lib/cache";
import { parseDuration } from "@/lib/duration";
import type { ModuleServices } from "@/modules";
import { createAuthService } from "@/modules/auth/auth.service";
import { createGoogleCodeExchanger } from "@/modules/auth/google-code";
import { createGoogleTokenVerifier } from "@/modules/auth/google-token";
import { createRefreshTokenRepo } from "@/modules/auth/refresh-token.repo";
import { createDevicesRepo } from "@/modules/devices/devices.repo";
import {
  createOperationsCache,
  createVersionOperationsLoader,
} from "@/modules/mock-runtime/operations-cache";
import { fetchSchemaUrl } from "@/modules/mocks/import/fetch-url";
import { createSchemaImporter } from "@/modules/mocks/import/importer";
import { createMocksRepo } from "@/modules/mocks/mocks.repo";
import { createMocksService, type MocksServiceDeps } from "@/modules/mocks/mocks.service";
import { createOverridesRepo } from "@/modules/mocks/overrides.repo";
import { createNotificationsRepo } from "@/modules/notifications/notifications.repo";
import { createUserNotificationsRepo } from "@/modules/notifications/user-notifications.repo";
import { createPersonalAccessTokensRepo } from "@/modules/personal-access-tokens/personal-access-tokens.repo";
import { createPersonalAccessTokensService } from "@/modules/personal-access-tokens/personal-access-tokens.service";
import { createUsageRepo } from "@/modules/usage/usage.repo";
import { createUsageService } from "@/modules/usage/usage.service";
import { createUserRepo } from "@/modules/users/users.repo";
import { createUsersService } from "@/modules/users/users.service";
import { createInvitesRepo } from "@/modules/workspaces/invites.repo";
import { createInvitesService } from "@/modules/workspaces/invites.service";
import { createMembersRepo } from "@/modules/workspaces/members.repo";
import { createMembersService } from "@/modules/workspaces/members.service";
import { createWorkspacesRepo } from "@/modules/workspaces/workspaces.repo";
import { createWorkspacesService } from "@/modules/workspaces/workspaces.service";

// Structural subset of CreateAppOptions (app.ts): only the injectable
// services/factories, so this file never imports from app.ts (no cycles).
// Module services come in through Partial<ModuleServices>, so a generated
// module's injection slot exists without editing this interface.
export interface ResolveServicesOptions extends Partial<ModuleServices> {
  adminAuthService?: AdminAuthService;
  adminRegistry?: AdminRegistry;
  crudServiceFactory?: (def: AdminResourceDef) => CrudService;
  adminNotificationsService?: AdminNotificationsService;
}

// Default wiring. The postgres.js pool connects lazily, so building these
// never touches the database until a request actually runs a query.
// The explicit return type makes a module wired into ModuleServices but
// missing here a compile error pointing at this file.
//
// Read/write split policy (db/client.ts): repos built from `db` send reads to
// the replica and writes to the primary automatically. Repos where a stale
// read is incorrect — identity and auth, where a row is read back right after
// being written (refresh-token rotation/reuse detection, session validation,
// admin save→refetch) — are built from `db.$primary` so every query hits the
// primary. High-volume content reads tolerate replication lag and stay on `db`.
function createDefaultServices(): ModuleServices {
  const userRepo = createUserRepo(db.$primary);
  const workspacesRepo = createWorkspacesRepo(db.$primary);
  // Primary-pinned: GET /workspaces creates the personal workspace and the
  // UI immediately navigates into it. Built before authService, whose
  // sign-in hook provisions it and applies domain join.
  const workspacesService = createWorkspacesService({
    workspacesRepo,
    userRepo,
    invalidate,
    allowedHd: env.APP_GOOGLE_ALLOWED_HD,
  });
  return {
    authService: createAuthService({
      userRepo,
      refreshTokenRepo: createRefreshTokenRepo(db.$primary),
      // Lazy singleton lookup: safe to wire before startBoss() has run.
      enqueue,
      // Public Google sign-in shares the admin OAuth client id as the token
      // audience; split into its own env key if a separate client is created.
      googleTokenVerifier: createGoogleTokenVerifier({ clientId: env.GOOGLE_CLIENT_ID }),
      // GIS popup-code exchange (POST /auth/google/code); same OAuth client.
      googleCodeExchanger: createGoogleCodeExchanger({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      }),
      afterGoogleSignIn: (input) => workspacesService.onGoogleSignIn(input),
      allowedHd: env.APP_GOOGLE_ALLOWED_HD,
      jwtSecret: env.JWT_SECRET,
      accessTtlSeconds: parseDuration(env.JWT_ACCESS_TTL),
      refreshTtlSeconds: parseDuration(env.JWT_REFRESH_TTL),
    }),
    usersService: createUsersService({ userRepo }),
    workspacesService,
    // Primary-pinned: the Members page refetches right after every change.
    membersService: createMembersService({ membersRepo: createMembersRepo(db.$primary) }),
    // Primary-pinned: the invite-email job is enqueued right after each
    // insert, and accepting reads back the membership it just wrote.
    invitesService: createInvitesService({
      invitesRepo: createInvitesRepo(db.$primary),
      workspacesRepo,
      userRepo,
      enqueue,
      allowedHd: env.APP_GOOGLE_ALLOWED_HD,
    }),
    // Primary-pinned: every mutation reads its result back immediately, and the
    // runtime route cache must never be refilled from a lagging replica.
    mocksService: createMocksService(mocksServiceDeps()),
    // Reports tolerate replica lag (they already lag the 1-minute flush).
    usageService: createUsageService({ usageRepo: createUsageRepo(db) }),
    // Primary-pinned: a just-revoked token must never authenticate off a
    // lagging replica, and the list refetches right after create/revoke.
    personalAccessTokensService: createPersonalAccessTokensService({
      repo: createPersonalAccessTokensRepo(db.$primary),
      workspacesService,
      mcpUrl: new URL(`${env.API_BASE_PATH}/mcp`, env.API_URL).toString(),
    }),
  };
}

function mocksServiceDeps(): MocksServiceDeps {
  const mocksRepo = createMocksRepo(db.$primary);
  // Versions are immutable, so parsed operations never go stale (same LRU
  // the mock runtime uses, separate instance: the runtime is split-ready).
  const operations = createOperationsCache({
    max: env.MOCK_OPS_CACHE_SIZE,
    load: createVersionOperationsLoader(mocksRepo),
  });
  return {
    mocksRepo,
    overridesRepo: createOverridesRepo(db.$primary),
    schemaImporter: createSchemaImporter({ fetchUrl: (url) => fetchSchemaUrl(url) }),
    invalidate,
    publicBaseUrl: env.MOCK_PUBLIC_BASE_URL,
    versionOperations: (versionId) => operations.get(versionId),
  };
}

function createDefaultAdminNotificationsService(): AdminNotificationsService {
  return createAdminNotificationsService({
    notificationsRepo: createNotificationsRepo(db),
    userNotificationsRepo: createUserNotificationsRepo(db),
    devicesRepo: createDevicesRepo(db),
    enqueue,
    cancelJob,
    pushSender: createPushSender(),
  });
}

function createDefaultAdminAuthService(): AdminAuthService {
  return createAdminAuthService({
    // Primary-pinned: a session/admin row is read on the request immediately
    // after login writes it — a lagged replica read would 401 fresh logins.
    adminUsersRepo: createAdminUsersRepo(db.$primary),
    adminSessionsRepo: createAdminSessionsRepo(db.$primary),
    google: createGoogleOAuth({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      // Must byte-match a redirect URI registered in the Google console.
      redirectUri: new URL(
        `${env.API_BASE_PATH}/admin/auth/google/callback`,
        env.API_URL,
      ).toString(),
    }),
    allowedHd: env.GOOGLE_ALLOWED_HD,
    sessionSecret: env.ADMIN_SESSION_SECRET,
    seedOwnerEmail: env.ADMIN_SEED_OWNER_EMAIL,
  });
}

// Fills every gap in the injected options with production wiring. Tests
// inject fakes through CreateAppOptions; index.ts injects nothing and gets
// the Drizzle-backed defaults.
export function resolveServices(options: ResolveServicesOptions) {
  const adminAuthService = options.adminAuthService ?? createDefaultAdminAuthService();
  const adminRegistry =
    options.adminRegistry ??
    createDefaultAdminRegistry({ adminUsersRepo: createAdminUsersRepo(db.$primary) });
  // Admin CRUD is primary-pinned: the admin UI refetches right after every
  // save, admin traffic is tiny, and stale edit forms are confusing bugs.
  const crudServiceFactory =
    options.crudServiceFactory ??
    ((def: AdminResourceDef) =>
      createCrudService({ repo: createCrudRepo(db.$primary, def.table), hooks: def.hooks }));
  const adminNotificationsService =
    options.adminNotificationsService ?? createDefaultAdminNotificationsService();
  const defaults = createDefaultServices();
  const modules: ModuleServices = {
    authService: options.authService ?? defaults.authService,
    usersService: options.usersService ?? defaults.usersService,
    workspacesService: options.workspacesService ?? defaults.workspacesService,
    membersService: options.membersService ?? defaults.membersService,
    invitesService: options.invitesService ?? defaults.invitesService,
    mocksService: options.mocksService ?? defaults.mocksService,
    usageService: options.usageService ?? defaults.usageService,
    personalAccessTokensService:
      options.personalAccessTokensService ?? defaults.personalAccessTokensService,
  };
  return {
    modules,
    adminAuthService,
    adminRegistry,
    crudServiceFactory,
    adminNotificationsService,
  };
}
