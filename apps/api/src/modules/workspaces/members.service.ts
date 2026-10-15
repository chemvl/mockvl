import type { InviteRole, Workspace, WorkspaceMember } from "@starter/schemas";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { MembersRepo } from "./members.repo";
import { NO_PERMISSION } from "./workspaces.errors";

export interface MembersServiceDeps {
  membersRepo: MembersRepo;
}

export interface MembersService {
  // Owner, Admin, Editor, Viewer; then by name (email when unnamed).
  list(ws: Workspace): Promise<WorkspaceMember[]>;
  updateRole(
    ws: Workspace,
    actorId: string,
    targetId: string,
    role: InviteRole,
  ): Promise<WorkspaceMember>;
  remove(ws: Workspace, actorId: string, targetId: string): Promise<void>;
}

export function createMembersService({ membersRepo }: MembersServiceDeps): MembersService {
  // Nobody changes or removes themselves (leave is its own route) or the
  // owner (ownership only moves by transfer).
  async function loadManageable(ws: Workspace, actorId: string, targetId: string) {
    if (targetId === actorId) throw new ForbiddenError(NO_PERMISSION);
    const target = await membersRepo.find(ws.id, targetId);
    if (!target) throw new NotFoundError("Member not found");
    if (target.role === "owner") throw new ForbiddenError(NO_PERMISSION);
    return target;
  }

  return {
    list(ws) {
      return membersRepo.list(ws.id);
    },

    async updateRole(ws, actorId, targetId, role) {
      const target = await loadManageable(ws, actorId, targetId);
      if (target.role === role) return target;
      await membersRepo.updateRole({
        workspaceId: ws.id,
        actorId,
        userId: targetId,
        from: target.role,
        to: role,
      });
      return { ...target, role };
    },

    async remove(ws, actorId, targetId) {
      const target = await loadManageable(ws, actorId, targetId);
      await membersRepo.remove({
        workspaceId: ws.id,
        actorId,
        userId: targetId,
        email: target.email,
      });
    },
  };
}
