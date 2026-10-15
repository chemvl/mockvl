import { env } from "@/config/env";
import type { Db } from "@/db/client";
import type { Enqueue } from "@/jobs/types";
import type { InvalidateFn } from "@/lib/cache";
import { createVersionOperationsLoader } from "@/modules/mock-runtime/operations-cache";
import { createSchemaImporter } from "@/modules/mocks/import/importer";
import { createMocksRepo } from "@/modules/mocks/mocks.repo";
import { createMocksService } from "@/modules/mocks/mocks.service";
import { createOverridesRepo } from "@/modules/mocks/overrides.repo";
import { createPersonalAccessTokensRepo } from "@/modules/personal-access-tokens/personal-access-tokens.repo";
import { createPersonalAccessTokensService } from "@/modules/personal-access-tokens/personal-access-tokens.service";
import { createUsageRepo } from "@/modules/usage/usage.repo";
import { createUsageService } from "@/modules/usage/usage.service";
import { createUserRepo } from "@/modules/users/users.repo";
import { createInvitesRepo } from "@/modules/workspaces/invites.repo";
import { createInvitesService } from "@/modules/workspaces/invites.service";
import { createMembersRepo } from "@/modules/workspaces/members.repo";
import { createMembersService } from "@/modules/workspaces/members.service";
import { createWorkspacesRepo } from "@/modules/workspaces/workspaces.repo";
import { createWorkspacesService } from "@/modules/workspaces/workspaces.service";

export interface MockvlServiceOptions {
  // Stands in for the SSRF-safe fetcher; default fails loudly.
  fetchUrl?: (url: string) => Promise<string>;
  // Receives every invalidated cache key.
  invalidated?: string[];
  // Also forwards every invalidation, e.g. to a real createCache() instance.
  invalidate?: InvalidateFn;
  // Receives every enqueued job (invite emails); default drops them.
  enqueue?: Enqueue;
}

// The Mockvl service graph over a test-owned pool, with no network: URL
// fetches are faked, invalidation is recorded (and forwarded to a real cache
// only when options.invalidate is given).
export function createMockvlServices(db: Db, options: MockvlServiceOptions = {}) {
  const invalidate: InvalidateFn = async (...keys) => {
    options.invalidated?.push(...keys);
    await options.invalidate?.(...keys);
  };
  const userRepo = createUserRepo(db);
  const workspacesRepo = createWorkspacesRepo(db);
  const workspacesService = createWorkspacesService({ workspacesRepo, userRepo, invalidate });
  const mocksRepo = createMocksRepo(db);
  const overridesRepo = createOverridesRepo(db);
  const mocksService = createMocksService({
    mocksRepo,
    overridesRepo,
    schemaImporter: createSchemaImporter({
      fetchUrl:
        options.fetchUrl ??
        (async (url) => {
          throw new Error(`unexpected schema fetch: ${url}`);
        }),
    }),
    invalidate,
    publicBaseUrl: env.MOCK_PUBLIC_BASE_URL,
    versionOperations: createVersionOperationsLoader(mocksRepo),
  });
  const usageService = createUsageService({ usageRepo: createUsageRepo(db) });
  const membersService = createMembersService({ membersRepo: createMembersRepo(db) });
  const invitesService = createInvitesService({
    invitesRepo: createInvitesRepo(db),
    workspacesRepo,
    userRepo,
    enqueue: options.enqueue ?? (async () => null),
  });
  const personalAccessTokensRepo = createPersonalAccessTokensRepo(db);
  const personalAccessTokensService = createPersonalAccessTokensService({
    repo: personalAccessTokensRepo,
    workspacesService,
    mcpUrl: new URL(`${env.API_BASE_PATH}/mcp`, env.API_URL).toString(),
  });
  return {
    userRepo,
    workspacesService,
    membersService,
    invitesService,
    mocksRepo,
    overridesRepo,
    mocksService,
    usageService,
    personalAccessTokensRepo,
    personalAccessTokensService,
  };
}
