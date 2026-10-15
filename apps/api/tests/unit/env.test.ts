import "../setup";
import { describe, expect, test } from "bun:test";
import { parseEnv } from "@/config/env";

const VALID_SOURCE = {
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/app",
  JWT_SECRET: "a-jwt-secret-that-is-at-least-32-chars",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_ALLOWED_HD: "company.com",
  ADMIN_SESSION_SECRET: "an-admin-secret-that-is-32-chars-long",
  ADMIN_URL: "http://localhost:5173",
  API_URL: "http://localhost:3000",
  APP_URL: "http://localhost:8080",
  REDIS_URL: "redis://localhost:6380",
};

describe("parseEnv", () => {
  test("parses a valid environment and applies defaults", () => {
    const env = parseEnv(VALID_SOURCE);

    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3000);
    expect(env.JWT_ACCESS_TTL).toBe("15m");
    expect(env.JWT_REFRESH_TTL).toBe("30d");
    expect(env.DOCS_ENABLED).toBe(true);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.CACHE_DEFAULT_TTL_S).toBe(300);
    expect(env.RATE_LIMIT_FAIL_OPEN).toBe(true);
    expect(env.RATE_LIMIT_GLOBAL_LIMIT).toBe(100);
    expect(env.RATE_LIMIT_GLOBAL_WINDOW_MS).toBe(60_000);
    expect(env.RATE_LIMIT_AUTH_LIMIT).toBe(10);
    expect(env.RATE_LIMIT_AUTH_WINDOW_MS).toBe(60_000);
    expect(env.TRUST_PROXY).toBe(false);
  });

  test("coerces RATE_LIMIT_* limits/windows to numbers and TRUST_PROXY to a boolean", () => {
    const env = parseEnv({
      ...VALID_SOURCE,
      RATE_LIMIT_GLOBAL_LIMIT: "2000",
      RATE_LIMIT_GLOBAL_WINDOW_MS: "30000",
      RATE_LIMIT_AUTH_LIMIT: "60",
      RATE_LIMIT_AUTH_WINDOW_MS: "120000",
      TRUST_PROXY: "true",
    });

    expect(env.RATE_LIMIT_GLOBAL_LIMIT).toBe(2000);
    expect(env.RATE_LIMIT_GLOBAL_WINDOW_MS).toBe(30_000);
    expect(env.RATE_LIMIT_AUTH_LIMIT).toBe(60);
    expect(env.RATE_LIMIT_AUTH_WINDOW_MS).toBe(120_000);
    expect(env.TRUST_PROXY).toBe(true);
  });

  test("rejects non-positive or non-numeric rate limits", () => {
    expect(() => parseEnv({ ...VALID_SOURCE, RATE_LIMIT_GLOBAL_LIMIT: "0" })).toThrow(
      /RATE_LIMIT_GLOBAL_LIMIT/,
    );
    expect(() => parseEnv({ ...VALID_SOURCE, RATE_LIMIT_AUTH_LIMIT: "lots" })).toThrow(
      /RATE_LIMIT_AUTH_LIMIT/,
    );
  });

  test("requires REDIS_URL", () => {
    expect(() => parseEnv({})).toThrow(/REDIS_URL/);
  });

  test("treats empty DATABASE_REPLICA_URL as unset (CI passes it unconditionally)", () => {
    expect(parseEnv(VALID_SOURCE).DATABASE_REPLICA_URL).toBeUndefined();
    expect(
      parseEnv({ ...VALID_SOURCE, DATABASE_REPLICA_URL: "" }).DATABASE_REPLICA_URL,
    ).toBeUndefined();
    expect(
      parseEnv({ ...VALID_SOURCE, DATABASE_REPLICA_URL: "postgres://replica:5432/app" })
        .DATABASE_REPLICA_URL,
    ).toBe("postgres://replica:5432/app");
    expect(() => parseEnv({ ...VALID_SOURCE, DATABASE_REPLICA_URL: "not-a-url" })).toThrow(
      /DATABASE_REPLICA_URL/,
    );
  });

  test("coerces CACHE_DEFAULT_TTL_S to a number and RATE_LIMIT_FAIL_OPEN to a boolean", () => {
    const env = parseEnv({
      ...VALID_SOURCE,
      CACHE_DEFAULT_TTL_S: "60",
      RATE_LIMIT_FAIL_OPEN: "false",
    });

    expect(env.CACHE_DEFAULT_TTL_S).toBe(60);
    expect(env.RATE_LIMIT_FAIL_OPEN).toBe(false);
  });

  test("coerces PORT to a number and DOCS_ENABLED to a boolean", () => {
    const env = parseEnv({ ...VALID_SOURCE, PORT: "8080", DOCS_ENABLED: "false" });

    expect(env.PORT).toBe(8080);
    expect(env.DOCS_ENABLED).toBe(false);
  });

  test("throws with a readable list of every missing variable", () => {
    expect(() => parseEnv({})).toThrow(/Invalid environment variables/);
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({})).toThrow(/JWT_SECRET/);
    expect(() => parseEnv({})).toThrow(/ADMIN_SESSION_SECRET/);
  });

  test("rejects an invalid PORT", () => {
    expect(() => parseEnv({ ...VALID_SOURCE, PORT: "not-a-port" })).toThrow(/PORT/);
  });

  test("rejects a short JWT_SECRET", () => {
    expect(() => parseEnv({ ...VALID_SOURCE, JWT_SECRET: "short" })).toThrow(/JWT_SECRET/);
  });

  test("API_BASE_PATH defaults to /api and normalizes sloppy forms", () => {
    expect(parseEnv(VALID_SOURCE).API_BASE_PATH).toBe("/api");
    expect(parseEnv({ ...VALID_SOURCE, API_BASE_PATH: "/v1" }).API_BASE_PATH).toBe("/v1");
    // Missing leading slash and trailing slashes are repaired, not rejected.
    expect(parseEnv({ ...VALID_SOURCE, API_BASE_PATH: "api/" }).API_BASE_PATH).toBe("/api");
    expect(parseEnv({ ...VALID_SOURCE, API_BASE_PATH: "/api/" }).API_BASE_PATH).toBe("/api");
    // "/" means "serve at the root" and is normalized to "" for clean joins.
    expect(parseEnv({ ...VALID_SOURCE, API_BASE_PATH: "/" }).API_BASE_PATH).toBe("");
  });

  test("rejects an API_BASE_PATH with characters that don't belong in a path", () => {
    expect(() => parseEnv({ ...VALID_SOURCE, API_BASE_PATH: "/api docs" })).toThrow(
      /API_BASE_PATH/,
    );
    expect(() => parseEnv({ ...VALID_SOURCE, API_BASE_PATH: "https://x.com/api" })).toThrow(
      /API_BASE_PATH/,
    );
  });

  test("ADMIN_SEED_OWNER_EMAIL is optional but must be an email when present", () => {
    expect(parseEnv(VALID_SOURCE).ADMIN_SEED_OWNER_EMAIL).toBeUndefined();
    expect(
      parseEnv({ ...VALID_SOURCE, ADMIN_SEED_OWNER_EMAIL: "boss@company.com" })
        .ADMIN_SEED_OWNER_EMAIL,
    ).toBe("boss@company.com");
    expect(() => parseEnv({ ...VALID_SOURCE, ADMIN_SEED_OWNER_EMAIL: "not-an-email" })).toThrow(
      /ADMIN_SEED_OWNER_EMAIL/,
    );
  });

  test("APP_URL is required and must be a URL", () => {
    const { APP_URL: _omitted, ...withoutAppUrl } = VALID_SOURCE;
    expect(() => parseEnv(withoutAppUrl)).toThrow(/APP_URL/);
    expect(() => parseEnv({ ...VALID_SOURCE, APP_URL: "not-a-url" })).toThrow(/APP_URL/);
  });

  test("FCM keys are all-or-none and empty string counts as unset (CI passes them unconditionally)", () => {
    const unset = parseEnv({
      ...VALID_SOURCE,
      FCM_PROJECT_ID: "",
      FCM_CLIENT_EMAIL: "",
      FCM_PRIVATE_KEY: "",
    });
    expect(unset.FCM_PROJECT_ID).toBeUndefined();
    expect(unset.FCM_CLIENT_EMAIL).toBeUndefined();
    expect(unset.FCM_PRIVATE_KEY).toBeUndefined();

    expect(() =>
      parseEnv({
        ...VALID_SOURCE,
        FCM_PROJECT_ID: "proj",
        FCM_CLIENT_EMAIL: "",
        FCM_PRIVATE_KEY: "",
      }),
    ).toThrow(/FCM_CLIENT_EMAIL/);

    const all = parseEnv({
      ...VALID_SOURCE,
      FCM_PROJECT_ID: "proj",
      FCM_CLIENT_EMAIL: "sa@proj.iam.gserviceaccount.com",
      FCM_PRIVATE_KEY: "line1\\nline2",
    });
    expect(all.FCM_PRIVATE_KEY).toBe("line1\nline2");
  });

  test("Resend keys are all-or-none and empty string counts as unset", () => {
    expect(parseEnv(VALID_SOURCE).RESEND_API_KEY).toBeUndefined();
    expect(parseEnv({ ...VALID_SOURCE, RESEND_API_KEY: "" }).RESEND_API_KEY).toBeUndefined();

    expect(() => parseEnv({ ...VALID_SOURCE, RESEND_API_KEY: "re_123" })).toThrow(
      /RESEND_FROM_ADDRESS/,
    );
    expect(() => parseEnv({ ...VALID_SOURCE, RESEND_FROM_ADDRESS: "noreply@example.com" })).toThrow(
      /RESEND_API_KEY/,
    );
    expect(() =>
      parseEnv({ ...VALID_SOURCE, RESEND_API_KEY: "re_123", RESEND_FROM_ADDRESS: "not-an-email" }),
    ).toThrow(/RESEND_FROM_ADDRESS/);

    const both = parseEnv({
      ...VALID_SOURCE,
      RESEND_API_KEY: "re_123",
      RESEND_FROM_ADDRESS: "noreply@example.com",
    });
    expect(both.RESEND_API_KEY).toBe("re_123");
    expect(both.RESEND_FROM_ADDRESS).toBe("noreply@example.com");
  });

  test("EMAIL_PROVIDER parses known providers and rejects unknown values", () => {
    expect(parseEnv(VALID_SOURCE).EMAIL_PROVIDER).toBeUndefined();
    expect(parseEnv({ ...VALID_SOURCE, EMAIL_PROVIDER: "" }).EMAIL_PROVIDER).toBeUndefined();
    expect(parseEnv({ ...VALID_SOURCE, EMAIL_PROVIDER: "log-only" }).EMAIL_PROVIDER).toBe(
      "log-only",
    );
    expect(() => parseEnv({ ...VALID_SOURCE, EMAIL_PROVIDER: "sendgrid" })).toThrow();
  });

  test('EMAIL_PROVIDER="resend" requires the Resend pair', () => {
    expect(() => parseEnv({ ...VALID_SOURCE, EMAIL_PROVIDER: "resend" })).toThrow(/EMAIL_PROVIDER/);
    const env = parseEnv({
      ...VALID_SOURCE,
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_123",
      RESEND_FROM_ADDRESS: "noreply@yourdomain.com",
    });
    expect(env.EMAIL_PROVIDER).toBe("resend");
  });

  test("SMTP keys apply defaults and treat empty strings as unset", () => {
    const env = parseEnv(VALID_SOURCE);
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.SMTP_PORT).toBe(25);
    expect(env.SMTP_USERNAME).toBeUndefined();
    expect(env.SMTP_FROM_ADDRESS).toBeUndefined();

    // Deploy tooling may pass vars through unconditionally — "" must mean unset, not crash.
    const withEmpties = parseEnv({
      ...VALID_SOURCE,
      SMTP_HOST: "",
      SMTP_PORT: "",
      SMTP_USERNAME: "",
      SMTP_PASSWORD: "",
      SMTP_FROM_ADDRESS: "",
    });
    expect(withEmpties.SMTP_HOST).toBeUndefined();
    expect(withEmpties.SMTP_PORT).toBe(25);
    expect(withEmpties.SMTP_USERNAME).toBeUndefined();
  });

  test("SMTP auth keys are all-or-none as a pair", () => {
    expect(() => parseEnv({ ...VALID_SOURCE, SMTP_USERNAME: "tenant-user" })).toThrow(
      /SMTP_PASSWORD/,
    );
    expect(() => parseEnv({ ...VALID_SOURCE, SMTP_PASSWORD: "secret" })).toThrow(/SMTP_USERNAME/);
    const env = parseEnv({
      ...VALID_SOURCE,
      SMTP_USERNAME: "tenant-user",
      SMTP_PASSWORD: "secret",
    });
    expect(env.SMTP_USERNAME).toBe("tenant-user");
  });

  test('EMAIL_PROVIDER="smtp" requires host and from address (auth optional)', () => {
    expect(() =>
      parseEnv({ ...VALID_SOURCE, EMAIL_PROVIDER: "smtp", SMTP_HOST: "smtp.example.com" }),
    ).toThrow(/SMTP_FROM_ADDRESS/);
    const env = parseEnv({
      ...VALID_SOURCE,
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM_ADDRESS: "noreply@yourdomain.com",
    });
    expect(env.EMAIL_PROVIDER).toBe("smtp");
    expect(env.SMTP_HOST).toBe("smtp.example.com");
    expect(env.SMTP_FROM_ADDRESS).toBe("noreply@yourdomain.com");
  });

  test('EMAIL_PROVIDER="smtp" without SMTP_HOST fails with the SMTP_HOST message', () => {
    expect(() =>
      parseEnv({
        ...VALID_SOURCE,
        EMAIL_PROVIDER: "smtp",
        SMTP_FROM_ADDRESS: "noreply@yourdomain.com",
      }),
    ).toThrow('EMAIL_PROVIDER="smtp" requires SMTP_HOST');
  });
});

describe("Mockvl env keys", () => {
  test("MOCK_PUBLIC_BASE_URL defaults to APP_URL + /m and never ends with a slash", () => {
    expect(parseEnv(VALID_SOURCE).MOCK_PUBLIC_BASE_URL).toBe("http://localhost:8080/m");
    expect(parseEnv({ ...VALID_SOURCE, APP_URL: "https://app.test/" }).MOCK_PUBLIC_BASE_URL).toBe(
      "https://app.test/m",
    );
    expect(parseEnv({ ...VALID_SOURCE, MOCK_PUBLIC_BASE_URL: "" }).MOCK_PUBLIC_BASE_URL).toBe(
      "http://localhost:8080/m",
    );
    expect(
      parseEnv({ ...VALID_SOURCE, MOCK_PUBLIC_BASE_URL: "https://mocks.test/x/" })
        .MOCK_PUBLIC_BASE_URL,
    ).toBe("https://mocks.test/x");
    expect(() => parseEnv({ ...VALID_SOURCE, MOCK_PUBLIC_BASE_URL: "nope" })).toThrow(
      /MOCK_PUBLIC_BASE_URL/,
    );
  });

  test("mock tiers have defaults and APP_GOOGLE_ALLOWED_HD is optional", () => {
    const parsed = parseEnv(VALID_SOURCE);
    expect(parsed.MOCK_RATE_LIMIT_PER_MINUTE).toBe(600);
    expect(parsed.MOCK_OPS_CACHE_SIZE).toBe(200);
    expect(parsed.APP_GOOGLE_ALLOWED_HD).toBeUndefined();
    expect(parseEnv({ ...VALID_SOURCE, APP_GOOGLE_ALLOWED_HD: "" }).APP_GOOGLE_ALLOWED_HD).toBe(
      undefined,
    );
    expect(
      parseEnv({ ...VALID_SOURCE, APP_GOOGLE_ALLOWED_HD: "company.com" }).APP_GOOGLE_ALLOWED_HD,
    ).toBe("company.com");
    expect(() => parseEnv({ ...VALID_SOURCE, MOCK_OPS_CACHE_SIZE: "0" })).toThrow(
      /MOCK_OPS_CACHE_SIZE/,
    );
  });
});
