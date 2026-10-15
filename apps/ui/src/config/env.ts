import { z } from "zod";

const UiEnvSchema = z.object({
  VITE_GOOGLE_CLIENT_ID: z.string().default(""),
  VITE_GOOGLE_HD: z.string().default(""),
});

const parsed = UiEnvSchema.parse(import.meta.env);

export const uiEnv = {
  googleClientId: parsed.VITE_GOOGLE_CLIENT_ID,
  googleHd: parsed.VITE_GOOGLE_HD,
} as const;
