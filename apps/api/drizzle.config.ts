import { defineConfig } from "drizzle-kit";
// Env access goes through config/env.ts everywhere, including this CLI config.
// The db:* scripts pass --env-file=../../.env so the root .env is loaded
// regardless of the working directory Bun resolves .env files from.
import { env } from "./src/config/env";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: env.DATABASE_URL },
});
