import { z } from "zod";

const MIN_SECRET_LENGTH = 32;

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    // Prefix for every route (e.g. "/api" → /api/docs). Set to "/" to serve at
    // the root. Normalized: leading slash added, trailing slashes stripped, and
    // the root form becomes "" so `${API_BASE_PATH}/health`-style joins never
    // produce a double slash — "api/", "/api/" and "/api" all mean "/api".
    API_BASE_PATH: z
      .string()
      .default("/api")
      .refine((value) => /^[A-Za-z0-9\-._~/]*$/.test(value), {
        message: 'must be a URL path like "/api" (or "/" to serve at the root)',
      })
      .transform((value) => {
        const trimmed = value.replace(/\/+$/, "");
        if (trimmed === "") return "";
        return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
      }),
    DATABASE_URL: z.url(),
    // Streaming read replica. When unset, all reads fall back to the primary
    // (dev/test/CI run on a single database). Never point migrations at it.
    // "" counts as unset: deploy tooling may pass unset variables as empty
    // strings, which must disable the feature, not crash boot.
    DATABASE_REPLICA_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.url().optional(),
    ),
    // Per-process connections for EACH pool (primary and replica). With a
    // replica configured a pod holds up to 2× this many connections — size
    // against Postgres max_connections × pod count.
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    JWT_SECRET: z.string().min(MIN_SECRET_LENGTH),
    JWT_ACCESS_TTL: z.string().min(1).default("15m"),
    JWT_REFRESH_TTL: z.string().min(1).default("30d"),

    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    GOOGLE_ALLOWED_HD: z.string().min(1),

    ADMIN_SESSION_SECRET: z.string().min(MIN_SECRET_LENGTH),
    ADMIN_URL: z.url(),
    API_URL: z.url(),
    // Public app origin (the Mockyard SPA). Neither ADMIN_URL (dashboard) nor
    // API_URL (this API) is the user-facing app, so this is its own required
    // key; MOCK_PUBLIC_BASE_URL defaults to `${APP_URL}/m`.
    APP_URL: z.url(),
    // First-owner seeding: an admin logging in with this email is created as
    // (or promoted to) `owner`. Everyone else defaults to `viewer`.
    ADMIN_SEED_OWNER_EMAIL: z.email().optional(),

    // FCM push (all-or-none, enforced below): omit all three to run with the
    // log-only push sender — the template boots without a Firebase project.
    // "" counts as unset: deploy tooling may pass unset variables as empty
    // strings, which must disable the feature, not crash boot.
    FCM_PROJECT_ID: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    FCM_CLIENT_EMAIL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.email().optional(),
    ),
    // Service-account private key (PEM). `\n` escapes are unfolded so the key
    // can live on one line in .env / secret stores.
    FCM_PRIVATE_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .min(1)
        .transform((value) => value.replaceAll("\\n", "\n"))
        .optional(),
    ),

    // Resend email delivery (all-or-none, enforced below): omit both to run
    // with the log-only sender — the template boots without a Resend account.
    // "" counts as unset for CI parity; *_KEY puts it under log redaction.
    RESEND_API_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    RESEND_FROM_ADDRESS: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.email().optional(),
    ),
    // Which email provider the boot factory wires (clients/email/index.ts):
    //   resend | smtp | log-only. Unset = legacy auto-detect
    //   (Resend when its pair is set, otherwise workers keep their log-only
    //   defaults). Explicit selection stays unambiguous when several
    //   credential sets exist, e.g. mid-migration between providers.
    EMAIL_PROVIDER: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.enum(["resend", "smtp", "log-only"]).optional(),
    ),
    // Generic SMTP transport (clients/email/smtp.ts). Plaintext only (no TLS).
    // Auth optional: SMTP_USERNAME/SMTP_PASSWORD all-or-none. "" counts as unset.
    SMTP_HOST: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    SMTP_PORT: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.coerce.number().int().min(1).max(65_535).default(25),
    ),
    SMTP_USERNAME: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    SMTP_PASSWORD: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    SMTP_FROM_ADDRESS: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.email().optional(),
    ),

    REDIS_URL: z.url(),
    CACHE_DEFAULT_TTL_S: z.coerce.number().int().min(1).default(300),
    // Redis outage stance for rate limiting: true = serve traffic and log,
    // false = reject with 429. Locks/idempotency always fail closed (Phase 8.5d).
    RATE_LIMIT_FAIL_OPEN: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    // Per-tier limits (middleware/rate-limit.ts). Defaults mirror the in-code
    // constants. The limits are PER IP: behind carrier-grade NAT one address can
    // carry hundreds of real users, so size as
    //   max users per IP × requests per user per minute × 2
    // and treat the global tier as a flood backstop, not a fairness control.
    RATE_LIMIT_GLOBAL_LIMIT: z.coerce.number().int().min(1).default(100),
    RATE_LIMIT_GLOBAL_WINDOW_MS: z.coerce.number().int().min(1).default(60_000),
    RATE_LIMIT_AUTH_LIMIT: z.coerce.number().int().min(1).default(10),
    RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().int().min(1).default(60_000),
    // Mockyard.
    // Public base of hosted mocks. Unset or "" = `${APP_URL}/m`, filled in by
    // the transform at the end of this schema (the default depends on APP_URL).
    MOCK_PUBLIC_BASE_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.url().optional(),
    ),
    // When set, only verified Google Workspace accounts of this domain may sign
    // in to the app realm (hd claim) or use workspace routes (email suffix).
    APP_GOOGLE_ALLOWED_HD: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    // The `mock` rate-limit tier: requests per minute per (client IP, mock).
    MOCK_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(600),
    // In-process LRU of parsed Prism operations, keyed by mock version id.
    MOCK_OPS_CACHE_SIZE: z.coerce.number().int().min(1).default(200),
    // true = a trusted reverse proxy (nginx ingress, LB) fronts the API, so the
    // client IP is read from x-real-ip / the rightmost x-forwarded-for hop.
    // false = the API is exposed directly; forwarded headers are client-forgeable
    // (trivial rate-limit bypass) and are ignored in favor of the socket address.
    TRUST_PROXY: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),

    DOCS_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
  })
  .superRefine((value, ctx) => {
    const fcmKeys = ["FCM_PROJECT_ID", "FCM_CLIENT_EMAIL", "FCM_PRIVATE_KEY"] as const;
    const present = fcmKeys.filter((key) => value[key] !== undefined);
    if (present.length > 0 && present.length < fcmKeys.length) {
      for (const key of fcmKeys) {
        if (value[key] === undefined) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message:
              "FCM env keys are all-or-none: set all of FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY or none",
          });
        }
      }
    }
    const resendKeys = ["RESEND_API_KEY", "RESEND_FROM_ADDRESS"] as const;
    const resendPresent = resendKeys.filter((key) => value[key] !== undefined);
    if (resendPresent.length > 0 && resendPresent.length < resendKeys.length) {
      for (const key of resendKeys) {
        if (value[key] === undefined) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message:
              "Resend env keys are all-or-none: set both RESEND_API_KEY and RESEND_FROM_ADDRESS or neither",
          });
        }
      }
    }
    const smtpAuthKeys = ["SMTP_USERNAME", "SMTP_PASSWORD"] as const;
    const smtpAuthPresent = smtpAuthKeys.filter((key) => value[key] !== undefined);
    if (smtpAuthPresent.length > 0 && smtpAuthPresent.length < smtpAuthKeys.length) {
      for (const key of smtpAuthKeys) {
        if (value[key] === undefined) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message:
              "SMTP auth keys are all-or-none: set both SMTP_USERNAME and SMTP_PASSWORD or neither",
          });
        }
      }
    }
    // An explicitly selected provider must be fully configured — failing at
    // boot beats silently sending nothing.
    if (
      value.EMAIL_PROVIDER === "resend" &&
      (value.RESEND_API_KEY === undefined || value.RESEND_FROM_ADDRESS === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_PROVIDER"],
        message: 'EMAIL_PROVIDER="resend" requires RESEND_API_KEY and RESEND_FROM_ADDRESS',
      });
    }
    if (value.EMAIL_PROVIDER === "smtp") {
      if (value.SMTP_HOST === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["SMTP_HOST"],
          message: 'EMAIL_PROVIDER="smtp" requires SMTP_HOST',
        });
      }
      if (value.SMTP_FROM_ADDRESS === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["SMTP_FROM_ADDRESS"],
          message: 'EMAIL_PROVIDER="smtp" requires SMTP_FROM_ADDRESS',
        });
      }
    }
  })
  .transform((value) => ({
    ...value,
    MOCK_PUBLIC_BASE_URL: (
      value.MOCK_PUBLIC_BASE_URL ?? `${value.APP_URL.replace(/\/+$/, "")}/m`
    ).replace(/\/+$/, ""),
  }));

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables (see .env.example):\n${issues}`);
  }
  return result.data;
}

// Parsed once at import time so a misconfigured process fails at boot,
// not on the first request that touches the missing value.
export const env: Env = parseEnv(process.env);
