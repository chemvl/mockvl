import { AppError } from "@/lib/errors";

// Every permission denial (role too low, acting on the owner or on yourself)
// uses this copy with ForbiddenError.
export const NO_PERMISSION = "You don't have permission to do that. Ask an Admin.";

// One factory per spec error code. Messages are user-facing and rendered
// verbatim by the UI — copy changes must update the spec too.
export const workspaceErrors = {
  slugInvalid: () =>
    new AppError("SLUG_INVALID", 400, "Use lowercase letters, numbers and hyphens."),
  slugReserved: (slug: string) => new AppError("SLUG_RESERVED", 409, `${slug} is reserved`),
  slugTaken: (slug: string) => new AppError("SLUG_TAKEN", 409, `${slug} is already taken`),
  workspaceLimit: () =>
    new AppError("WORKSPACE_LIMIT_REACHED", 409, "You can be in up to 50 workspaces."),
  memberLimit: () =>
    new AppError("MEMBER_LIMIT_REACHED", 409, "A workspace can have up to 200 members."),
  inviteBatchTooLarge: () =>
    new AppError("INVITE_BATCH_TOO_LARGE", 400, "You can invite up to 100 people at a time."),
  confirmMismatch: (slug: string) =>
    new AppError("CONFIRM_MISMATCH", 400, `Type ${slug} to confirm.`),
  lastWorkspace: () => new AppError("LAST_WORKSPACE", 409, "You can't delete your only workspace."),
  ownerCannotLeave: () =>
    new AppError("OWNER_CANNOT_LEAVE", 409, "Transfer ownership before you leave."),
  transferTargetInvalid: () =>
    new AppError("TRANSFER_TARGET_INVALID", 409, "Make someone an Admin first."),
  domainJoinUnavailable: (domain: string) =>
    new AppError(
      "DOMAIN_JOIN_UNAVAILABLE",
      400,
      `Domain join isn't available for ${domain} accounts.`,
    ),
  inviteInvalid: () => new AppError("INVITE_INVALID", 410, "This invite is no longer valid."),
  inviteExpired: () => new AppError("INVITE_EXPIRED", 410, "This invite has expired."),
  inviteEmailMismatch: (email: string) =>
    new AppError("INVITE_EMAIL_MISMATCH", 403, `This invite is for ${email}.`),
};
