import type { PersonalAccessTokenScope, TokenExpiryDays } from "@/lib/api/types";

export const SCOPE_LABELS: Record<PersonalAccessTokenScope, string> = {
  "mocks:read": "Read only",
  "mocks:write": "Read & write",
};

export const EXPIRY_OPTIONS: readonly TokenExpiryDays[] = [7, 30, 90, 365];
