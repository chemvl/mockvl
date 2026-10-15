import type {
  AcceptInviteResult,
  CreateWorkspaceInvites,
  InviteLookup,
  InviteResult,
  InviteRole,
  Workspace,
  WorkspaceInvite,
} from "@starter/schemas";
import { z } from "zod";
import type { Enqueue } from "@/jobs/types";
import { isUniqueViolation } from "@/lib/db-errors";
import { NotFoundError } from "@/lib/errors";
import { generateOpaqueToken, hashOpaqueToken } from "@/modules/auth/auth.tokens";
import type { UserRepo } from "@/modules/users/users.repo";
import type { InviteRow, InvitesRepo, TokenInvite } from "./invites.repo";
import {
  emailDomain,
  INVITE_TTL_DAYS,
  MAX_INVITES_PER_REQUEST,
  MAX_MEMBERS_PER_WORKSPACE,
  MAX_WORKSPACES_PER_USER,
} from "./workspaces.constants";
import { workspaceErrors } from "./workspaces.errors";
import type { WorkspacesRepo } from "./workspaces.repo";
import { createAllowedUserLoader } from "./workspaces.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const EmailSchema = z.email();

export interface InvitesServiceDeps {
  invitesRepo: InvitesRepo;
  workspacesRepo: Pick<WorkspacesRepo, "countActiveMemberships">;
  userRepo: Pick<UserRepo, "findById">;
  // Receives { inviteId, token } after each invite commits; the raw token
  // never touches the database.
  enqueue: Enqueue;
  // APP_GOOGLE_ALLOWED_HD: only addresses on it can ever sign in.
  allowedHd?: string;
  now?: () => Date;
}

export interface InvitesService {
  list(ws: Workspace): Promise<WorkspaceInvite[]>;
  // One result per distinct (trimmed, lowercased) email, in input order.
  create(ws: Workspace, actorId: string, input: CreateWorkspaceInvites): Promise<InviteResult[]>;
  resend(ws: Workspace, actorId: string, inviteId: string): Promise<WorkspaceInvite>;
  revoke(ws: Workspace, actorId: string, inviteId: string): Promise<void>;
  lookup(userId: string, token: string): Promise<InviteLookup>;
  accept(userId: string, token: string): Promise<AcceptInviteResult>;
  decline(userId: string, token: string): Promise<void>;
}

type Classified =
  | { email: string; result: InviteResult }
  | { email: string; resendId: string }
  | { email: string; resendId: null };

export function createInvitesService(deps: InvitesServiceDeps): InvitesService {
  const { invitesRepo, workspacesRepo, userRepo, enqueue, allowedHd } = deps;
  const now = deps.now ?? (() => new Date());
  const loadAllowedUser = createAllowedUserLoader(userRepo, allowedHd);

  function toWorkspaceInvite(row: InviteRow): WorkspaceInvite {
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      sentAt: row.sentAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      expired: row.expiresAt.getTime() < now().getTime(),
    };
  }

  // A fresh token, valid for INVITE_TTL_DAYS from now.
  function issue(role: InviteRole) {
    const token = generateOpaqueToken();
    const sentAt = now();
    return {
      token,
      fields: {
        role,
        tokenHash: hashOpaqueToken(token),
        sentAt,
        expiresAt: new Date(sentAt.getTime() + INVITE_TTL_DAYS * DAY_MS),
      },
    };
  }

  async function resendOpen(ws: Workspace, actorId: string, inviteId: string, role: InviteRole) {
    const { token, fields } = issue(role);
    const row = await invitesRepo.refresh({ inviteId, workspaceId: ws.id, actorId, ...fields });
    if (row) await enqueue("invite-email", { inviteId: row.id, token });
    return row;
  }

  // New invite, or a resend when one is already open for the email
  // (classified as such, or created concurrently since the check).
  async function send(
    ws: Workspace,
    actorId: string,
    email: string,
    role: InviteRole,
    resendId: string | null,
  ): Promise<InviteResult["status"]> {
    if (resendId !== null && (await resendOpen(ws, actorId, resendId, role))) return "resent";
    const { token, fields } = issue(role);
    try {
      const row = await invitesRepo.create({
        workspaceId: ws.id,
        email,
        invitedBy: actorId,
        ...fields,
      });
      await enqueue("invite-email", { inviteId: row.id, token });
      return "sent";
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const [open] = await invitesRepo.findOpenByEmails(ws.id, [email]);
      if (open && (await resendOpen(ws, actorId, open.id, role))) return "resent";
      throw error;
    }
  }

  // First match wins: already a member, no longer open, expired, wrong
  // account, else valid.
  async function stateOf(
    invite: TokenInvite,
    user: { id: string; email: string },
  ): Promise<InviteLookup["state"]> {
    if (await invitesRepo.isMember(invite.workspaceId, user.id)) return "already_member";
    if (invite.acceptedAt !== null || invite.revokedAt !== null) return "invalid";
    if (invite.expiresAt.getTime() < now().getTime()) return "expired";
    if (user.email.toLowerCase() !== invite.email) return "email_mismatch";
    return "valid";
  }

  async function resolve(userId: string, token: string) {
    const user = await loadAllowedUser(userId);
    const invite = await invitesRepo.findByTokenHash(hashOpaqueToken(token));
    if (!invite) throw new NotFoundError("Invite not found");
    return { user, invite, state: await stateOf(invite, user) };
  }

  return {
    async list(ws) {
      const rows = await invitesRepo.listOpen(ws.id);
      return rows.map(toWorkspaceInvite);
    },

    async create(ws, actorId, { emails: rawEmails, role }) {
      if (rawEmails.length > MAX_INVITES_PER_REQUEST) throw workspaceErrors.inviteBatchTooLarge();
      const emails = [...new Set(rawEmails.map((email) => email.trim().toLowerCase()))];
      const valid = emails.filter((email) => EmailSchema.safeParse(email).success);
      const members = new Set(await invitesRepo.memberEmails(ws.id, valid));
      const open = new Map(
        (await invitesRepo.findOpenByEmails(ws.id, valid)).map((row) => [row.email, row.id]),
      );
      // Seats left once every open invite is accepted; resends hold theirs.
      let capacity =
        MAX_MEMBERS_PER_WORKSPACE - ws.memberCount - (await invitesRepo.countOpen(ws.id));

      const classified = emails.map((email): Classified => {
        const fail = (status: InviteResult["status"], message: string) => ({
          email,
          result: { email, status, message },
        });
        if (!EmailSchema.safeParse(email).success) {
          return fail("invalid", `${email} isn't a valid email address.`);
        }
        if (allowedHd !== undefined && emailDomain(email) !== allowedHd.toLowerCase()) {
          return fail("failed", `${email} isn't a ${allowedHd} Google account.`);
        }
        if (members.has(email)) return fail("already_member", `${email} is already a member.`);
        const resendId = open.get(email);
        if (resendId !== undefined) return { email, resendId };
        if (capacity <= 0) return fail("failed", workspaceErrors.memberLimit().message);
        capacity -= 1;
        return { email, resendId: null };
      });

      // Sequential: each invite is its own transaction, enqueued after it
      // commits, so a failure part-way leaves earlier ones sent.
      const results: InviteResult[] = [];
      for (const item of classified) {
        if ("result" in item) {
          results.push(item.result);
          continue;
        }
        const status = await send(ws, actorId, item.email, role, item.resendId);
        results.push({ email: item.email, status, message: null });
      }
      return results;
    },

    async resend(ws, actorId, inviteId) {
      const invite = await invitesRepo.findOpen(ws.id, inviteId);
      const row = invite && (await resendOpen(ws, actorId, invite.id, invite.role));
      if (!row) throw new NotFoundError("Invite not found");
      return toWorkspaceInvite(row);
    },

    async revoke(ws, actorId, inviteId) {
      if (!(await invitesRepo.revoke(ws.id, inviteId, actorId, now()))) {
        throw new NotFoundError("Invite not found");
      }
    },

    async lookup(userId, token) {
      const { user, invite, state } = await resolve(userId, token);
      return {
        state,
        email: invite.email,
        signedInEmail: user.email,
        role: invite.role,
        workspace: {
          name: invite.workspace.name,
          slug: invite.workspace.slug,
          mockCount: invite.workspace.mockCount,
        },
        inviter: invite.inviter,
      };
    },

    async accept(userId, token) {
      const { user, invite, state } = await resolve(userId, token);
      const joined = { slug: invite.workspace.slug, name: invite.workspace.name };
      if (state === "already_member") return joined;
      if (state === "invalid") throw workspaceErrors.inviteInvalid();
      if (state === "expired") throw workspaceErrors.inviteExpired();
      if (state === "email_mismatch") throw workspaceErrors.inviteEmailMismatch(invite.email);
      if ((await workspacesRepo.countActiveMemberships(user.id)) >= MAX_WORKSPACES_PER_USER) {
        throw workspaceErrors.workspaceLimit();
      }
      if (invite.workspace.memberCount >= MAX_MEMBERS_PER_WORKSPACE) {
        throw workspaceErrors.memberLimit();
      }
      const accepted = await invitesRepo.accept({
        inviteId: invite.id,
        workspaceId: invite.workspaceId,
        userId: user.id,
        role: invite.role,
        at: now(),
      });
      // Revoked, declined or accepted between the lookup and the write.
      if (!accepted) throw workspaceErrors.inviteInvalid();
      return joined;
    },

    async decline(userId, token) {
      const { invite, state } = await resolve(userId, token);
      if (state === "email_mismatch") throw workspaceErrors.inviteEmailMismatch(invite.email);
      if (state === "valid" || state === "expired") await invitesRepo.decline(invite.id, now());
    },
  };
}
