import "../setup";
import { describe, expect, test } from "bun:test";
import { createApp } from "@/app";

// Minimal shape of the parts of an OpenAPI 3.2 document these tests inspect.
type OpenApiDoc = {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, { security?: Record<string, string[]>[] }>>;
  components: {
    schemas: Record<string, unknown>;
    securitySchemes: Record<string, { type: string; scheme?: string; bearerFormat?: string }>;
  };
};

async function fetchSpec() {
  const res = await createApp().request("/api/openapi.json");
  expect(res.status).toBe(200);
  return (await res.json()) as OpenApiDoc;
}

describe("GET /openapi.json", () => {
  test("serves a spec documenting every route", async () => {
    const spec = await fetchSpec();

    expect(spec.openapi).toBe("3.2.0");
    expect(spec.info.title).toBeString();
    // Documented paths carry the base path (API_BASE_PATH, default /api).
    for (const path of [
      "/api/health",
      "/api/ready",
      "/api/auth/google",
      "/api/auth/google/code",
      "/api/auth/refresh",
      "/api/auth/logout",
      "/api/users/me",
    ]) {
      expect(spec.paths[path]).toBeDefined();
    }
  });

  test("registers the error envelope as a shared component", async () => {
    const spec = await fetchSpec();

    expect(spec.components.schemas.ErrorResponse).toBeDefined();
    // Error responses reference the shared component instead of inlining it.
    expect(JSON.stringify(spec.paths["/api/auth/refresh"]?.post)).toContain(
      "#/components/schemas/ErrorResponse",
    );
  });

  test("documents bearer auth on protected routes", async () => {
    const spec = await fetchSpec();

    expect(spec.components.securitySchemes.bearerAuth).toEqual({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
    });
    expect(spec.paths["/api/users/me"]?.get?.security).toEqual([{ bearerAuth: [] }]);
  });
});

describe("GET /docs", () => {
  test("renders the Scalar UI pointing at the spec", async () => {
    const res = await createApp().request("/api/docs");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("/api/openapi.json");
  });
});

describe("DOCS_ENABLED gating", () => {
  test("disabling docs hides both the spec and the UI", async () => {
    const app = createApp({ docsEnabled: false });

    expect((await app.request("/api/openapi.json")).status).toBe(404);
    expect((await app.request("/api/docs")).status).toBe(404);
  });
});

// The UI's generated SDK names functions after operationId — renames are
// breaking changes for apps/ui.
type OperationIds = Record<string, Record<string, { operationId?: string }>>;

describe("operationIds", () => {
  test("auth and user routes used by the UI carry stable operationIds", async () => {
    // OpenApiDoc above omits operationId; this view adds only that field.
    const paths = (await fetchSpec()).paths as unknown as OperationIds;
    expect(paths["/api/auth/google"]?.post?.operationId).toBe("loginWithGoogle");
    expect(paths["/api/auth/google/code"]?.post?.operationId).toBe("loginWithGoogleCode");
    expect(paths["/api/auth/refresh"]?.post?.operationId).toBe("refreshTokens");
    expect(paths["/api/auth/logout"]?.post?.operationId).toBe("logout");
    expect(paths["/api/users/me"]?.get?.operationId).toBe("getMe");
  });

  test("Mockyard routes carry the spec's operationIds", async () => {
    const paths = (await fetchSpec()).paths as unknown as OperationIds;
    const ws = "/api/workspaces/{ws}";
    expect(paths["/api/workspaces"]?.get?.operationId).toBe("listWorkspaces");
    expect(paths[`${ws}/mocks`]?.get?.operationId).toBe("listMocks");
    expect(paths[`${ws}/mocks`]?.post?.operationId).toBe("createMock");
    expect(paths[`${ws}/mocks/slug-availability`]?.get?.operationId).toBe("checkMockSlug");
    expect(paths[`${ws}/schema/inspect`]?.post?.operationId).toBe("inspectSchema");
    expect(paths[`${ws}/mocks/{slug}`]?.get?.operationId).toBe("getMock");
    expect(paths[`${ws}/mocks/{slug}`]?.patch?.operationId).toBe("updateMock");
    expect(paths[`${ws}/mocks/{slug}`]?.delete?.operationId).toBe("deleteMock");
    expect(paths[`${ws}/mocks/{slug}/versions`]?.get?.operationId).toBe("listMockVersions");
    expect(paths[`${ws}/mocks/{slug}/versions`]?.post?.operationId).toBe("replaceMockSchema");
    expect(paths[`${ws}/mocks/{slug}/resync`]?.post?.operationId).toBe("resyncMock");
    expect(paths[`${ws}/mocks/{slug}/versions/{number}/restore`]?.post?.operationId).toBe(
      "restoreMockVersion",
    );
    expect(paths[`${ws}/mocks/{slug}/overrides`]?.get?.operationId).toBe("listMockOverrides");
    expect(paths[`${ws}/mocks/{slug}/overrides`]?.put?.operationId).toBe("saveMockOverride");
    expect(paths[`${ws}/mocks/{slug}/overrides`]?.delete?.operationId).toBe("resetMockOverride");
  });

  test("the usage route carries getWorkspaceUsage", async () => {
    const paths = (await fetchSpec()).paths as unknown as OperationIds;
    expect(paths["/api/workspaces/{ws}/usage"]?.get?.operationId).toBe("getWorkspaceUsage");
  });
});
