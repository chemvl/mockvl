import { z } from "@hono/zod-openapi";
import { UserSchema } from "./user";

const REFRESH_TOKEN_MAX = 512; // real tokens are 43 chars; cap junk before hashing
const ID_TOKEN_MAX = 4096; // Google ID tokens are ~1–2 KB; cap junk before verification

export const RefreshSchema = z
  .object({
    refreshToken: z.string().min(1).max(REFRESH_TOKEN_MAX).openapi({
      example: "wJalrXUtnFEMI_K7MDENG_bPxRfiCYEXAMPLEKEY_43c",
    }),
  })
  .openapi("RefreshRequest");

export const LogoutSchema = RefreshSchema;

export const GoogleLoginSchema = z
  .object({
    idToken: z.string().min(1).max(ID_TOKEN_MAX).openapi({
      description: "Google ID token obtained client-side (Google Identity Services)",
      example: "eyJhbGciOiJSUzI1NiIs...",
    }),
  })
  .openapi("GoogleLoginRequest");

// The refresh token is opaque and single-use: returned once here, then rotated.
export const TokenPairSchema = z
  .object({
    accessToken: z.string().openapi({ description: "JWT, expires per JWT_ACCESS_TTL" }),
    refreshToken: z.string().openapi({ description: "Opaque single-use token" }),
  })
  .openapi("TokenPair");

export const AuthSessionSchema = TokenPairSchema.extend({ user: UserSchema }).openapi(
  "AuthSession",
);

export const LogoutResultSchema = z.object({ success: z.literal(true) }).openapi("LogoutResult");

export type GoogleLogin = z.infer<typeof GoogleLoginSchema>;
export type TokenPair = z.infer<typeof TokenPairSchema>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;

// GIS popup codes are ~70–100 chars; cap junk before the token exchange.
const AUTH_CODE_MAX = 2048;

export const GoogleCodeLoginSchema = z
  .object({
    code: z.string().min(1).max(AUTH_CODE_MAX).openapi({
      description: "Authorization code from Google Identity Services initCodeClient (popup)",
      example: "4/0AVMBsJ...",
    }),
  })
  .openapi("GoogleCodeLoginRequest");
