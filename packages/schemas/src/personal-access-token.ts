import { z } from "@hono/zod-openapi";

export const PERSONAL_ACCESS_TOKEN_SCOPES = ["mocks:read", "mocks:write"] as const;
export const PersonalAccessTokenScopeSchema = z
  .enum(PERSONAL_ACCESS_TOKEN_SCOPES)
  .openapi("PersonalAccessTokenScope");
export type PersonalAccessTokenScope = z.infer<typeof PersonalAccessTokenScopeSchema>;

export const PERSONAL_ACCESS_TOKEN_EXPIRY_DAYS = [7, 30, 90, 365] as const;

const isoDate = z.iso.datetime().openapi({ example: "2026-10-07T00:00:00.000Z" });

export const PersonalAccessTokenSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    scope: PersonalAccessTokenScopeSchema,
    tokenHint: z.string().openapi({ example: "mky_pat_…a1b2" }),
    expiresAt: isoDate,
    lastUsedAt: isoDate.nullable(),
    createdAt: isoDate,
  })
  .openapi("PersonalAccessToken");
export type PersonalAccessToken = z.infer<typeof PersonalAccessTokenSchema>;

export const CreatePersonalAccessTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(100).openapi({ example: "Claude Code" }),
    scope: PersonalAccessTokenScopeSchema,
    expiresInDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)]),
  })
  .openapi("CreatePersonalAccessToken");
export type CreatePersonalAccessToken = z.infer<typeof CreatePersonalAccessTokenSchema>;

export const CreatedPersonalAccessTokenSchema = z
  .object({
    token: PersonalAccessTokenSchema,
    plaintextToken: z.string().openapi({ description: "Shown once; never retrievable again" }),
    mcpUrl: z.url().openapi({ example: "https://mockyard.example.com/api/mcp" }),
  })
  .openapi("CreatedPersonalAccessToken");
export type CreatedPersonalAccessToken = z.infer<typeof CreatedPersonalAccessTokenSchema>;
