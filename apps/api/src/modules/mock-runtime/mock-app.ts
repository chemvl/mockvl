// The hosted-mock runtime: a self-contained Hono app for /m/{ws}/{slug}/…
// (spec § Mock runtime). It shares only reusable middleware with the API —
// none of the API's global chain (CORS, jsonOnly, envelopes) applies here,
// and errors are application/problem+json. Split-ready: nothing here imports
// the API's route modules, so it can move to its own entrypoint later.
import { createLogger as createPrismLogger } from "@stoplight/prism-core";
import { createInstance, type IHttpConfig, type IHttpOperationConfig } from "@stoplight/prism-http";
// Prism's default mocker. Internal path: prism-http has no `exports` map;
// pinned by prism-http@5.16.0 — re-run the overrides E2E on any upgrade.
import prismMock from "@stoplight/prism-http/dist/mocker";
import { DiagnosticSeverity, type IHttpOperation } from "@stoplight/types";
import * as E from "fp-ts/Either";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "@/lib/context";
import { AppError } from "@/lib/errors";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import { clientIp, createRateLimiter, type RateLimitSettings } from "@/middleware/rate-limit";
import { requestId } from "@/middleware/request-id";
import { requestLogger } from "@/middleware/request-logger";
import { isOperationMethod } from "@/modules/mocks/import/summarize";
import type { UsageCounter } from "@/modules/usage/usage-counter";
import type { OperationsCache } from "./operations-cache";
import type { OverrideStore } from "./override-store";
import { parsePreferences } from "./prefer";
import { mapRequest } from "./request-mapper";
import {
  MOCK_PROBLEMS,
  MOCKYARD_ERROR_TYPE,
  problemResponse,
  type SerializedResponse,
  serializeOverride,
  serializePrismError,
  serializePrismResponse,
} from "./response";
import type { MockRoute, RouteResolver } from "./route-resolver";
import { commaSafeValidateInput } from "./validate-input";

export const MOCK_MOUNT_PATH = "/m";
const MOCK_BODY_LIMIT_BYTES = 1024 * 1024;
const MOCK_PATH = /^\/m\/([^/]+)\/([^/]+)(\/.*)?$/;

// Mock responses are user-controlled content on the app's own origin.
const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": "sandbox; default-src 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

// Never Access-Control-Allow-Credentials: mocks are public and anonymous.
function corsHeaders(allowOrigin: string): Record<string, string> {
  return { "access-control-allow-origin": allowOrigin, "access-control-expose-headers": "*" };
}

const BASE_CONFIG = {
  mock: { dynamic: false },
  validateRequest: true,
  validateResponse: false,
  // Mocks are public and anonymous: a spec's `security` requirements are not
  // enforced, so callers never need credentials. `Prefer: code=401` still
  // returns the spec's 401 response for testing the unauthenticated path.
  checkSecurity: false,
  errors: false,
  upstreamProxy: undefined,
  isProxy: false,
} satisfies IHttpConfig;

// Prism's result doesn't say which operation it routed to. prism-core hands
// `config.mock` to the mock component unchanged, so a request-scoped sink on
// it receives the match (overrides spec § Mock runtime 1).
const MATCH_SINK = Symbol("mockyard.match");

interface MatchSink {
  method?: string;
  path?: string;
}

type CapturingMockConfig = IHttpOperationConfig & { [MATCH_SINK]?: MatchSink };

const capturingMock: typeof prismMock = (opts) => {
  const sink = (opts.config as CapturingMockConfig)[MATCH_SINK];
  if (sink) {
    sink.method = opts.resource.method;
    sink.path = opts.resource.path;
  }
  return prismMock(opts);
};

export interface MockTarget {
  ws: string;
  slug: string;
  rest: string;
}

export function parseMockPath(pathname: string): MockTarget | null {
  const match = MOCK_PATH.exec(pathname);
  if (!match?.[1] || !match[2]) return null;
  return { ws: match[1], slug: match[2], rest: match[3] || "/" };
}

export interface MockAppDeps {
  resolver: RouteResolver;
  operations: OperationsCache<IHttpOperation[]>;
  // Saved bodies per (mock, method, path template, status code).
  overrides: OverrideStore;
  usage: UsageCounter;
  // The `mock` tier: limit per (client IP, mock) per window. keyGenerator is
  // supplied here; store/trustProxy come from the caller.
  rateLimit: RateLimitSettings;
  log?: Logger;
  // Origin of the Mockyard SPA (APP_URL). Its endpoint preview calls mocks
  // from the browser, so this origin is always admitted — even when the
  // mock's own CORS setting is off (MOCK_PUBLIC_BASE_URL may be another
  // origin). Still never with credentials.
  appOrigin: string;
}

function send(serialized: SerializedResponse, extraHeaders: Record<string, string> = {}): Response {
  return new Response(serialized.body, {
    status: serialized.status,
    headers: { ...serialized.headers, ...extraHeaders },
  });
}

export function createMockApp(deps: MockAppDeps): Hono<AppEnv> {
  const log = deps.log ?? defaultLogger;
  // Prism requires its own pino flavor (custom `success` level).
  const prism = createInstance(BASE_CONFIG, {
    logger: createPrismLogger("mockyard", { level: "silent" }),
    mock: capturingMock,
    validateInput: commaSafeValidateInput,
  });
  const trustProxy = deps.rateLimit.trustProxy ?? false;

  function findOverride(mockId: string, match: MatchSink, code: number): Promise<string | null> {
    const method = match.method?.toLowerCase();
    if (method === undefined || !isOperationMethod(method) || match.path === undefined) {
      return Promise.resolve(null);
    }
    return deps.overrides.get(mockId, { method, path: match.path, code });
  }

  async function serve(
    c: Context<AppEnv>,
    target: MockTarget,
    route: MockRoute,
  ): Promise<Response> {
    // A mock with CORS on admits everyone; otherwise only the app itself.
    // The latter answer depends on Origin, hence Vary.
    const fromApp = c.req.header("origin") === deps.appOrigin;
    const allowOrigin = route.cors ? "*" : fromApp ? deps.appOrigin : null;
    const cors: Record<string, string> = {
      ...(allowOrigin ? corsHeaders(allowOrigin) : {}),
      ...(route.cors ? {} : { vary: "Origin" }),
    };
    const requestedMethod = c.req.header("access-control-request-method");
    if (allowOrigin && c.req.method === "OPTIONS" && requestedMethod) {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "access-control-allow-methods": requestedMethod,
          "access-control-allow-headers": c.req.header("access-control-request-headers") || "*",
          "access-control-max-age": "600",
        },
      });
    }
    if (route.status === "paused") return send(problemResponse(MOCK_PROBLEMS.paused), cors);

    const url = new URL(c.req.url);
    const prefer = parsePreferences(c.req.header("prefer"), url.searchParams);
    if (!prefer.ok) {
      return send(problemResponse(MOCK_PROBLEMS.invalidPreference(prefer.detail)), cors);
    }
    const bodyText = c.req.method === "GET" || c.req.method === "HEAD" ? "" : await c.req.text();
    const request = mapRequest({
      method: c.req.method,
      path: target.rest,
      query: url.searchParams,
      headers: c.req.raw.headers,
      bodyText,
    });
    if (!request) return send(problemResponse(MOCK_PROBLEMS.methodNotAllowed), cors);

    try {
      const operations = await deps.operations.get(route.liveVersionId);
      const match: MatchSink = {};
      const mockConfig: CapturingMockConfig = {
        dynamic: route.responseMode === "dynamic",
        ...prefer.overrides,
        [MATCH_SINK]: match,
      };
      const config: IHttpConfig = {
        ...BASE_CONFIG,
        mock: mockConfig,
        validateRequest: route.validateRequests,
      };
      const result = await prism.request(request, operations, config)();
      if (E.isLeft(result)) return send(serializePrismError(result.left), cors);
      const { output, validations } = result.right;
      // Validation 422s stay Prism's: only clean requests get a saved body.
      const clean = !validations.input.some((d) => d.severity === DiagnosticSeverity.Error);
      const saved = clean ? await findOverride(route.mockId, match, output.statusCode) : null;
      return send(
        saved === null ? serializePrismResponse(output) : serializeOverride(output, saved),
        cors,
      );
    } catch (err) {
      log.error({ err, mockId: route.mockId }, "mock request failed");
      return send(problemResponse(MOCK_PROBLEMS.internal), cors);
    }
  }

  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(requestLogger());
  // After next(): applies to every response, error responses included.
  // X-Request-Id is re-set here because requestId() uses c.header(), which
  // only reaches responses built through Context — this app returns raw ones.
  app.use(async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(name, value);
    c.res.headers.set("x-request-id", c.get("requestId"));
  });
  app.use(
    createRateLimiter({
      ...deps.rateLimit,
      keyGenerator: (c) => {
        const target = parseMockPath(c.req.path);
        return `${clientIp(c, trustProxy)}:${target ? `${target.ws}/${target.slug}` : "-"}`;
      },
    }),
  );
  app.use(
    bodyLimit({
      maxSize: MOCK_BODY_LIMIT_BYTES,
      onError: () => {
        throw new AppError("PAYLOAD_TOO_LARGE", 413, "Request body too large");
      },
    }),
  );

  app.all("*", async (c) => {
    const target = parseMockPath(c.req.path);
    const route = target ? await deps.resolver.resolve(target.ws, target.slug) : null;
    if (!target || !route) return send(problemResponse(MOCK_PROBLEMS.notFound));
    const response = await serve(c, target, route);
    // Fire-and-forget: record() never rejects and must not delay the reply.
    void deps.usage.record(route.mockId, response.status);
    return response;
  });

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return send(
        problemResponse({
          type: `${MOCKYARD_ERROR_TYPE}${err.code}`,
          title: err.message,
          status: err.status,
          detail: err.message,
        }),
      );
    }
    log.error({ err, path: c.req.path, requestId: c.get("requestId") }, "mock runtime error");
    return send(problemResponse(MOCK_PROBLEMS.internal));
  });

  return app;
}
