import type { InviteRole, WorkspaceMember, WorkspaceRole } from "@/lib/api/types";

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: "Everything, including transfer and delete.",
  admin: "Manage members, settings and all mocks.",
  editor: "Create and change mocks.",
  viewer: "See mocks and call them.",
};

export const INVITE_ROLE_OPTIONS: readonly { value: InviteRole; label: string }[] = [
  { value: "admin", label: "Admin — manage members and all mocks" },
  { value: "editor", label: "Editor — create and change mocks" },
  { value: "viewer", label: "Viewer — see mocks and call them" },
];

export const canEditMocks = (role: WorkspaceRole): boolean => role !== "viewer";

export const canManageWorkspace = (role: WorkspaceRole): boolean => role === "owner" || role === "admin";

/** Change role / remove: admins and owners, never on the owner row or their own row. */
export const canManageMember = (
  actorRole: WorkspaceRole,
  actorId: string,
  member: Pick<WorkspaceMember, "role" | "userId">,
): boolean => canManageWorkspace(actorRole) && member.role !== "owner" && member.userId !== actorId;
