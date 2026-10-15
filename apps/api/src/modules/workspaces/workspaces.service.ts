import {
  type CreateWorkspace,
  isValidWorkspaceSlug,
  type SlugAvailability,
  slugifyWorkspaceName,
  type UpdateWorkspace,
  WORKSPACE_SLUG_MAX_LENGTH,
  type Workspace,
  workspaceSlugProblem,
} from "@starter/schemas";
import type { InvalidateFn } from "@/lib/cache";
import { isUniqueViolation } from "@/lib/db-errors";
import { DomainNotAllowedError, NotFoundError } from "@/lib/errors";
import { workspaceRouteCachePattern } from "@/modules/mocks/mocks.cache";
import type { UserRepo } from "@/modules/users/users.repo";
import { emailDomain, MAX_WORKSPACES_PER_USER, PERSONAL_SUFFIX } from "./workspaces.constants";
import { workspaceErrors } from "./workspaces.errors";
import type { WorkspaceChanges, WorkspacesRepo } from "./workspaces.repo";

// Enough for any realistic collision run; past it something is wrong.
const MAX_SLUG_ATTEMPTS = 50;
const FALLBACK_SLUG = "workspace";
const MAX_NAME_LENGTH = 60;

export interface WorkspacesServiceDeps {
  workspacesRepo: WorkspacesRepo;
  userRepo: Pick<UserRepo, "findById" | "setLastWorkspace">;
  // Production passes lib/cache's invalidate: a slug change or delete moves
  // or removes every runtime route of the workspace.
  invalidate: InvalidateFn;
  // APP_GOOGLE_ALLOWED_HD. Checked on the account row (email suffix + verified)
  // because email/password accounts never carry an hd claim.
  allowedHd?: string;
}

export interface GoogleSignInInput {
  userId: string;
  // Verified Google Workspace domain claim; absent for consumer accounts.
  hd: string | undefined;
}

export interface WorkspacesService {
  listForUser(userId: string): Promise<Workspace[]>;
  requireMembership(userId: string, slug: string): Promise<Workspace>;
  onGoogleSignIn(input: GoogleSignInInput): Promise<void>;
  create(userId: string, input: CreateWorkspace): Promise<Workspace>;
  // wsSlug: the caller's current workspace, whose own old slugs are free to it.
  checkSlug(userId: string, slug: string, wsSlug?: string): Promise<SlugAvailability>;
  update(ws: Workspace, actorId: string, patch: UpdateWorkspace): Promise<Workspace>;
  remove(ws: Workspace, actorId: string, confirmSlug: string): Promise<void>;
  // Returns the caller's view of the workspace, now as Admin.
  transfer(ws: Workspace, actorId: string, targetUserId: string): Promise<Workspace>;
  leave(ws: Workspace, userId: string): Promise<void>;
}

// attempt 1 → base; attempt n → base truncated so `${base}-${n}` fits 32.
export function personalSlugCandidate(base: string, attempt: number): string {
  if (attempt === 1) return base;
  const suffix = `-${attempt}`;
  return `${base.slice(0, WORKSPACE_SLUG_MAX_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
}

// The caller's account row, with the APP_GOOGLE_ALLOWED_HD rule applied.
// Shared by every workspace-facing service (workspaces, invites).
export function createAllowedUserLoader(
  userRepo: Pick<UserRepo, "findById">,
  allowedHd: string | undefined,
) {
  return async function loadAllowedUser(userId: string) {
    const user = await userRepo.findById(userId);
    // Deleted after the JWT was issued — nothing to show.
    if (!user) throw new NotFoundError("Workspace not found");
    if (allowedHd !== undefined) {
      const inDomain = user.email.toLowerCase().endsWith(`@${allowedHd.toLowerCase()}`);
      if (!inDomain || user.emailVerifiedAt === null) throw new DomainNotAllowedError(allowedHd);
    }
    return user;
  };
}

export function createWorkspacesService(deps: WorkspacesServiceDeps): WorkspacesService {
  const { workspacesRepo, userRepo, invalidate, allowedHd } = deps;
  const loadAllowedUser = createAllowedUserLoader(userRepo, allowedHd);

  // Callers only provision when the user has no live membership. Idempotent
  // under concurrency: personal_owner_id is unique, so of two racing first
  // visits one insert wins and the other re-reads it.
  async function provisionPersonal(user: {
    id: string;
    email: string;
    name: string | null;
  }): Promise<Workspace> {
    const localPart = user.email.split("@")[0] ?? user.email;
    const display = user.name?.trim() || localPart;
    const name = `${display.slice(0, MAX_NAME_LENGTH - PERSONAL_SUFFIX.length)}${PERSONAL_SUFFIX}`;
    const slugBase = slugifyWorkspaceName(localPart).replace(/^[^a-z]+/, "");
    const base = isValidWorkspaceSlug(slugBase) ? slugBase : FALLBACK_SLUG;

    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = personalSlugCandidate(base, attempt);
      if (workspaceSlugProblem(slug) !== null || (await workspacesRepo.slugTaken(slug, null))) {
        continue;
      }
      try {
        return await workspacesRepo.insertWorkspace({
          slug,
          name,
          ownerId: user.id,
          domain: emailDomain(user.email),
          personal: true,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Either this user's workspace was created concurrently (return it)
        // or another user took the slug between check and insert (next one).
        const raced = await workspacesRepo.findPersonal(user.id);
        if (raced) return raced;
      }
    }
    throw new Error(`No free personal workspace slug for base "${base}"`);
  }

  // SLUG_INVALID / SLUG_RESERVED / SLUG_TAKEN for a create or rename target.
  async function assertSlugFree(slug: string, exceptWorkspaceId: string | null): Promise<void> {
    const problem = workspaceSlugProblem(slug);
    if (problem === "invalid") throw workspaceErrors.slugInvalid();
    if (problem === "reserved") throw workspaceErrors.slugReserved(slug);
    if (await workspacesRepo.slugTaken(slug, exceptWorkspaceId)) {
      throw workspaceErrors.slugTaken(slug);
    }
  }

  async function reload(slug: string, userId: string): Promise<Workspace> {
    const workspace = await workspacesRepo.findMembership(slug, userId);
    if (!workspace) throw new NotFoundError("Workspace not found");
    return workspace;
  }

  return {
    async listForUser(userId) {
      const user = await loadAllowedUser(userId);
      if ((await workspacesRepo.countActiveMemberships(userId)) === 0) {
        await provisionPersonal(user);
      }
      return workspacesRepo.listForUser(userId, user.lastWorkspaceId);
    },

    // "Missing" and "not a member" are indistinguishable on purpose. Every
    // scoped request also records activity and the last-used workspace.
    async requireMembership(userId, slug) {
      const user = await loadAllowedUser(userId);
      const membership = await workspacesRepo.findMembership(slug, userId);
      if (!membership) throw new NotFoundError("Workspace not found");
      await workspacesRepo.touchMembership(membership.id, userId);
      if (user.lastWorkspaceId !== membership.id) {
        await userRepo.setLastWorkspace(userId, membership.id);
      }
      return membership;
    },

    // Personal workspace for a first sign-in, then domain join: a verified
    // `hd` adds the user as Viewer to every matching workspace that has the
    // rule on, up to the per-user workspace limit.
    async onGoogleSignIn({ userId, hd }) {
      const user = await loadAllowedUser(userId);
      let memberships = await workspacesRepo.countActiveMemberships(userId);
      if (memberships === 0) {
        await provisionPersonal(user);
        memberships = 1;
      }
      if (!hd) return;
      const candidates = await workspacesRepo.domainJoinCandidates(hd.toLowerCase(), userId);
      for (const workspaceId of candidates) {
        if (memberships >= MAX_WORKSPACES_PER_USER) break;
        if (await workspacesRepo.addMember(workspaceId, userId, "viewer")) memberships += 1;
      }
    },

    async create(userId, { name, slug }) {
      const user = await loadAllowedUser(userId);
      await assertSlugFree(slug, null);
      if ((await workspacesRepo.countActiveMemberships(userId)) >= MAX_WORKSPACES_PER_USER) {
        throw workspaceErrors.workspaceLimit();
      }
      try {
        return await workspacesRepo.insertWorkspace({
          slug,
          name,
          ownerId: userId,
          domain: emailDomain(user.email),
          personal: false,
        });
      } catch (error) {
        // Another workspace took the slug between the check and the insert.
        if (isUniqueViolation(error)) throw workspaceErrors.slugTaken(slug);
        throw error;
      }
    },

    async checkSlug(userId, slug, wsSlug) {
      await loadAllowedUser(userId);
      const problem = workspaceSlugProblem(slug);
      if (problem) return { slug, available: false, reason: problem };
      const current =
        wsSlug === undefined ? undefined : await workspacesRepo.findMembership(wsSlug, userId);
      if (await workspacesRepo.slugTaken(slug, current?.id ?? null)) {
        return { slug, available: false, reason: "taken" };
      }
      return { slug, available: true, reason: null };
    },

    // Everything is validated before the single repo transaction, so a
    // rejected field never leaves the others half-applied.
    async update(ws, actorId, patch) {
      const { slug, ...settings } = patch;
      if (settings.domainJoinEnabled === true && !ws.domainJoinAvailable) {
        throw workspaceErrors.domainJoinUnavailable(ws.domain);
      }
      const changes: WorkspaceChanges = { ...settings };
      if (slug !== undefined && slug !== ws.slug) {
        await assertSlugFree(slug, ws.id);
        changes.slug = { from: ws.slug, to: slug };
      }
      if (Object.values(changes).every((value) => value === undefined)) return ws;
      try {
        await workspacesRepo.updateWorkspace(ws.id, actorId, changes);
      } catch (error) {
        if (changes.slug && isUniqueViolation(error)) {
          throw workspaceErrors.slugTaken(changes.slug.to);
        }
        throw error;
      }
      if (changes.slug) {
        await invalidate(
          workspaceRouteCachePattern(changes.slug.from),
          workspaceRouteCachePattern(changes.slug.to),
        );
      }
      return reload(changes.slug?.to ?? ws.slug, actorId);
    },

    async remove(ws, actorId, confirmSlug) {
      if (confirmSlug !== ws.slug) throw workspaceErrors.confirmMismatch(ws.slug);
      if (ws.personal && (await workspacesRepo.countActiveMemberships(actorId)) === 1) {
        throw workspaceErrors.lastWorkspace();
      }
      await workspacesRepo.softDelete(ws.id, actorId);
      await invalidate(workspaceRouteCachePattern(ws.slug));
    },

    // Only an Admin can become owner ("Make someone an Admin first."); the
    // caller (the owner) is never an Admin, so self-transfer is rejected too.
    async transfer(ws, actorId, targetUserId) {
      const target = await workspacesRepo.findMember(ws.id, targetUserId);
      if (target?.role !== "admin") throw workspaceErrors.transferTargetInvalid();
      await workspacesRepo.transferOwnership({
        workspaceId: ws.id,
        fromUserId: actorId,
        toUserId: targetUserId,
        toDomain: emailDomain(target.email),
      });
      return reload(ws.slug, actorId);
    },

    async leave(ws, userId) {
      if (ws.role === "owner") throw workspaceErrors.ownerCannotLeave();
      await workspacesRepo.leave(ws.id, userId);
    },
  };
}
