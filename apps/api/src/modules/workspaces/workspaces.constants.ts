import type { WorkspaceRole } from "@starter/schemas";

// Limits and copy shared by the workspace, member and invite services.
export const MAX_WORKSPACES_PER_USER = 50;
export const MAX_MEMBERS_PER_WORKSPACE = 200;
export const MAX_INVITES_PER_REQUEST = 100;
export const INVITE_TTL_DAYS = 7;
export const SLUG_RESERVATION_DAYS = 30;
export const DELETED_WORKSPACE_RETENTION_DAYS = 30;
export const LAST_ACTIVE_THROTTLE_MINUTES = 5;
export const PERSONAL_SUFFIX = " (personal)";

// Shared mail providers: anyone can hold an address there, so a workspace
// owned from one of these can't use domain join.
export const CONSUMER_EMAIL_DOMAINS: Readonly<Record<string, true>> = {
  "gmail.com": true,
  "googlemail.com": true,
  "outlook.com": true,
  "hotmail.com": true,
  "live.com": true,
  "msn.com": true,
  "yahoo.com": true,
  "icloud.com": true,
  "me.com": true,
  "aol.com": true,
  "proton.me": true,
  "protonmail.com": true,
  "gmx.com": true,
  "yandex.com": true,
  "mail.com": true,
};

// Own-property check: `in` would also match Object.prototype keys.
export const isConsumerEmailDomain = (domain: string): boolean =>
  Object.hasOwn(CONSUMER_EMAIL_DOMAINS, domain);

export const MOCK_EDITOR_ROLES: readonly WorkspaceRole[] = ["owner", "admin", "editor"];
export const WORKSPACE_ADMIN_ROLES: readonly WorkspaceRole[] = ["owner", "admin"];
export const OWNER_ROLES: readonly WorkspaceRole[] = ["owner"];

export const emailDomain = (email: string): string => email.split("@")[1]?.toLowerCase() ?? "";
