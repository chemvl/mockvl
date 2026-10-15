import { z } from "@hono/zod-openapi";
import type { ResourceField } from "./resource";

export const WORKSPACE_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export const WorkspaceRoleSchema = z.enum(WORKSPACE_ROLES).openapi("WorkspaceRole");
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

// Ownership only moves by transfer, so invites and role changes never grant it.
export const INVITE_ROLES = ["admin", "editor", "viewer"] as const;
export const InviteRoleSchema = z.enum(INVITE_ROLES).openapi("InviteRole");
export type InviteRole = z.infer<typeof InviteRoleSchema>;

const uuid = z.uuid().openapi({ example: "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a" });
const isoDate = z.iso.datetime().openapi({ example: "2026-10-07T00:00:00.000Z" });
const workspaceName = z.string().trim().min(1).max(60).openapi({ example: "Platform Team" });
// Loose cap only: the service checks the slug rules so it can answer with
// SLUG_INVALID / SLUG_RESERVED copy instead of a generic validation error.
const workspaceSlugInput = z.string().max(200).openapi({ example: "platform-team" });

export const WorkspaceSchema = z
  .object({
    id: uuid,
    slug: z.string().openapi({ example: "jane" }),
    name: z.string().openapi({ example: "Jane Doe (personal)" }),
    role: WorkspaceRoleSchema,
    personal: z.boolean(),
    mockCount: z.int().openapi({ example: 3 }),
    memberCount: z.int().openapi({ example: 1 }),
    // Email domain of the owner; domain join matches Google `hd` against it.
    domain: z.string().openapi({ example: "example.com" }),
    // False for consumer mail domains (gmail.com, …), where domain join is off.
    domainJoinAvailable: z.boolean(),
    domainJoinEnabled: z.boolean(),
    defaultValidate: z.boolean(),
    defaultCors: z.boolean(),
  })
  .openapi("Workspace");
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const CreateWorkspaceSchema = z
  .object({ name: workspaceName, slug: workspaceSlugInput })
  .openapi("CreateWorkspace");
export type CreateWorkspace = z.infer<typeof CreateWorkspaceSchema>;

export const UpdateWorkspaceSchema = z
  .object({
    name: workspaceName.optional(),
    slug: workspaceSlugInput.optional(),
    domainJoinEnabled: z.boolean().optional(),
    defaultValidate: z.boolean().optional(),
    defaultCors: z.boolean().optional(),
  })
  .openapi("UpdateWorkspace");
export type UpdateWorkspace = z.infer<typeof UpdateWorkspaceSchema>;

export const DeleteWorkspaceSchema = z
  .object({ confirmSlug: z.string().openapi({ example: "platform-team" }) })
  .openapi("DeleteWorkspace");
export type DeleteWorkspace = z.infer<typeof DeleteWorkspaceSchema>;

export const TransferWorkspaceSchema = z.object({ userId: uuid }).openapi("TransferWorkspace");
export type TransferWorkspace = z.infer<typeof TransferWorkspaceSchema>;

export const WorkspaceMemberSchema = z
  .object({
    userId: uuid,
    name: z.string().nullable().openapi({ example: "Jane Doe" }),
    email: z.string().openapi({ example: "jane@example.com" }),
    avatarUrl: z.string().nullable(),
    role: WorkspaceRoleSchema,
    joinedAt: isoDate,
    // Null until the member first opens the workspace.
    lastActiveAt: isoDate.nullable(),
  })
  .openapi("WorkspaceMember");
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

export const UpdateWorkspaceMemberSchema = z
  .object({ role: InviteRoleSchema })
  .openapi("UpdateWorkspaceMember");
export type UpdateWorkspaceMember = z.infer<typeof UpdateWorkspaceMemberSchema>;

export const WorkspaceInviteSchema = z
  .object({
    id: uuid,
    email: z.string().openapi({ example: "sam@example.com" }),
    role: InviteRoleSchema,
    sentAt: isoDate,
    expiresAt: isoDate,
    expired: z.boolean(),
  })
  .openapi("WorkspaceInvite");
export type WorkspaceInvite = z.infer<typeof WorkspaceInviteSchema>;

// No array max here: the service rejects > 100 with INVITE_BATCH_TOO_LARGE
// copy, and per-email validity is reported in InviteResult rather than failing
// the whole batch.
export const CreateWorkspaceInvitesSchema = z
  .object({
    emails: z
      .array(z.string().max(320))
      .min(1)
      .openapi({ example: ["sam@example.com"] }),
    role: InviteRoleSchema,
  })
  .openapi("CreateWorkspaceInvites");
export type CreateWorkspaceInvites = z.infer<typeof CreateWorkspaceInvitesSchema>;

export const INVITE_RESULT_STATUSES = [
  "sent",
  "resent",
  "already_member",
  "invalid",
  "failed",
] as const;

export const InviteResultSchema = z
  .object({
    email: z.string().openapi({ example: "sam@example.com" }),
    status: z.enum(INVITE_RESULT_STATUSES),
    message: z.string().nullable(),
  })
  .openapi("InviteResult");
export type InviteResult = z.infer<typeof InviteResultSchema>;

export const INVITE_LOOKUP_STATES = [
  "valid",
  "email_mismatch",
  "expired",
  "invalid",
  "already_member",
] as const;

export const InviteLookupSchema = z
  .object({
    state: z.enum(INVITE_LOOKUP_STATES),
    email: z.string().openapi({ example: "sam@example.com" }),
    signedInEmail: z.string().openapi({ example: "sam@example.com" }),
    role: InviteRoleSchema,
    workspace: z.object({
      name: z.string().openapi({ example: "Platform Team" }),
      slug: z.string().openapi({ example: "platform-team" }),
      mockCount: z.int().openapi({ example: 3 }),
    }),
    // Null when the inviting user has since been deleted.
    inviter: z
      .object({
        name: z.string().nullable().openapi({ example: "Jane Doe" }),
        email: z.string().openapi({ example: "jane@example.com" }),
      })
      .nullable(),
  })
  .openapi("InviteLookup");
export type InviteLookup = z.infer<typeof InviteLookupSchema>;

export const AcceptInviteResultSchema = z
  .object({
    slug: z.string().openapi({ example: "platform-team" }),
    name: z.string().openapi({ example: "Platform Team" }),
  })
  .openapi("AcceptInviteResult");
export type AcceptInviteResult = z.infer<typeof AcceptInviteResultSchema>;

// Row shape for the read-only admin `workspaces` resource — the raw table row,
// distinct from the per-member WorkspaceSchema response above.
export const WorkspaceAdminSchema = z
  .object({
    id: uuid,
    slug: z.string().openapi({ example: "platform-team" }),
    name: z.string().openapi({ example: "Platform Team" }),
    ownerId: uuid,
    personalOwnerId: uuid.nullable(),
    domain: z.string().openapi({ example: "example.com" }),
    domainJoinEnabled: z.boolean(),
    defaultValidate: z.boolean(),
    defaultCors: z.boolean(),
    deletedAt: isoDate.nullable(),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .openapi("WorkspaceAdmin");
export type WorkspaceAdmin = z.infer<typeof WorkspaceAdminSchema>;

// Workspaces are a read-only admin resource (list/get only), so every field is
// readOnly — no form ever renders. There is no show page either, so a field
// that is not a list column would be invisible.
export const workspaceFields: ResourceField[] = [
  {
    name: "name",
    type: "string",
    label: "Name",
    listColumn: true,
    searchable: true,
    readOnly: true,
  },
  {
    name: "slug",
    type: "string",
    label: "Slug",
    listColumn: true,
    searchable: true,
    readOnly: true,
  },
  {
    name: "ownerId",
    type: "relation",
    label: "Owner",
    resource: "users",
    displayField: "email",
    listColumn: true,
    filterable: true,
    readOnly: true,
  },
  {
    name: "domain",
    type: "string",
    label: "Domain",
    listColumn: true,
    searchable: true,
    readOnly: true,
  },
  {
    name: "domainJoinEnabled",
    type: "boolean",
    label: "Domain join",
    listColumn: true,
    filterable: true,
    readOnly: true,
  },
  {
    name: "defaultValidate",
    type: "boolean",
    label: "Validate by default",
    listColumn: true,
    readOnly: true,
  },
  {
    name: "defaultCors",
    type: "boolean",
    label: "CORS by default",
    listColumn: true,
    readOnly: true,
  },
  {
    name: "deletedAt",
    type: "date",
    label: "Deleted",
    listColumn: true,
    sortable: true,
    filterable: true,
    readOnly: true,
  },
  {
    name: "createdAt",
    type: "date",
    label: "Created",
    listColumn: true,
    sortable: true,
    readOnly: true,
  },
];
