import type {
  CreatedPersonalAccessToken,
  CreatePersonalAccessToken,
  PersonalAccessToken,
  PersonalAccessTokenScope,
  Workspace,
} from "@starter/schemas";
import type { PersonalAccessTokenRow } from "@/db/schema";
import { AppError, ForbiddenError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { generateOpaqueToken, hashOpaqueToken } from "@/modules/auth/auth.tokens";
import { MOCK_EDITOR_ROLES } from "@/modules/workspaces/workspaces.constants";
import { NO_PERMISSION } from "@/modules/workspaces/workspaces.errors";
import type { WorkspacesService } from "@/modules/workspaces/workspaces.service";
import {
  MAX_ACTIVE_PATS_PER_WORKSPACE,
  PAT_PATTERN,
  PAT_PREFIX,
} from "./personal-access-tokens.constants";
import { patErrors } from "./personal-access-tokens.errors";
import type { PersonalAccessTokensRepo } from "./personal-access-tokens.repo";

const DAY_MS = 86_400_000;

// The verified caller of an MCP request.
export interface McpPrincipal {
  tokenId: string;
  userId: string;
  scope: PersonalAccessTokenScope;
  expiresAt: Date;
  // Fresh from requireMembership on this request (current role).
  workspace: Workspace;
}

export interface PersonalAccessTokensServiceDeps {
  repo: PersonalAccessTokensRepo;
  workspacesService: Pick<WorkspacesService, "requireMembership">;
  // Public URL of the MCP endpoint, returned with every new token.
  mcpUrl: string;
  now?: () => Date;
}

export interface PersonalAccessTokensService {
  list(ws: Workspace, userId: string): Promise<PersonalAccessToken[]>;
  create(
    ws: Workspace,
    userId: string,
    input: CreatePersonalAccessToken,
  ): Promise<CreatedPersonalAccessToken>;
  // Not found unless the token is the caller's own in this workspace.
  revoke(ws: Workspace, userId: string, id: string): Promise<void>;
  // Null for any token that must not authenticate; never throws for those.
  authenticate(plaintextToken: string): Promise<McpPrincipal | null>;
}

function toPersonalAccessToken(row: PersonalAccessTokenRow): PersonalAccessToken {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    tokenHint: `${PAT_PREFIX}…${row.tokenHint}`,
    expiresAt: row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createPersonalAccessTokensService(
  deps: PersonalAccessTokensServiceDeps,
): PersonalAccessTokensService {
  const { repo, workspacesService, mcpUrl } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    async list(ws, userId) {
      const rows = await repo.listForUser(ws.id, userId);
      return rows.map(toPersonalAccessToken);
    },

    async create(ws, userId, input) {
      if (input.scope === "mocks:write" && !MOCK_EDITOR_ROLES.includes(ws.role)) {
        throw new ForbiddenError(NO_PERMISSION);
      }
      const createdAt = now();
      // Count-then-insert may overshoot by one or two under concurrent creates.
      if ((await repo.countActive(ws.id, userId, createdAt)) >= MAX_ACTIVE_PATS_PER_WORKSPACE) {
        throw patErrors.limitReached();
      }
      const plaintextToken = PAT_PREFIX + generateOpaqueToken();
      const row = await repo.insert({
        userId,
        workspaceId: ws.id,
        name: input.name,
        scope: input.scope,
        tokenHash: hashOpaqueToken(plaintextToken),
        tokenHint: plaintextToken.slice(-4),
        expiresAt: new Date(createdAt.getTime() + input.expiresInDays * DAY_MS),
      });
      logger.info(
        {
          tokenId: row.id,
          userId,
          workspaceId: ws.id,
          scope: row.scope,
          expiresAt: row.expiresAt,
        },
        "personal access token created",
      );
      return { token: toPersonalAccessToken(row), plaintextToken, mcpUrl };
    },

    async revoke(ws, userId, id) {
      if (!(await repo.revoke(id, ws.id, userId))) throw patErrors.notFound();
      logger.info({ tokenId: id, userId, workspaceId: ws.id }, "personal access token revoked");
    },

    async authenticate(plaintextToken) {
      // Shape check first: garbage never reaches the database.
      if (!PAT_PATTERN.test(plaintextToken)) return null;
      const row = await repo.findActiveByHash(hashOpaqueToken(plaintextToken), now());
      if (!row) return null;
      let workspace: Workspace;
      try {
        // Re-applies deleted-workspace, APP_GOOGLE_ALLOWED_HD, and the current role.
        workspace = await workspacesService.requireMembership(row.userId, row.workspaceSlug);
      } catch (err) {
        if (err instanceof AppError && err.status < 500) return null;
        throw err;
      }
      await repo.touchLastUsed(row.id);
      return {
        tokenId: row.id,
        userId: row.userId,
        scope: row.scope,
        expiresAt: row.expiresAt,
        workspace,
      };
    },
  };
}
