import "../setup";
import { describe, expect, test } from "bun:test";
import { createApp } from "@/app";
import { isSchemaRoute } from "@/app.middleware";

const MiB = 1024 * 1024;

function post(path: string, bytes: number) {
  return createApp().request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: { type: "file", filename: "x.yaml", content: "x".repeat(bytes) },
    }),
  });
}

describe("isSchemaRoute", () => {
  test("matches only the three schema-carrying POST routes", () => {
    expect(isSchemaRoute("POST", "/api/workspaces/jane/schema/inspect")).toBe(true);
    expect(isSchemaRoute("POST", "/api/workspaces/jane/mocks")).toBe(true);
    expect(isSchemaRoute("POST", "/api/workspaces/jane/mocks/pets/versions")).toBe(true);
    expect(isSchemaRoute("PATCH", "/api/workspaces/jane/mocks/pets")).toBe(false);
    expect(isSchemaRoute("POST", "/api/workspaces/jane/mocks/pets/resync")).toBe(false);
    expect(isSchemaRoute("POST", "/api/workspaces/jane/mocks/pets/versions/1/restore")).toBe(false);
    expect(isSchemaRoute("POST", "/api/auth/refresh")).toBe(false);
  });
});

describe("schema route body limit", () => {
  test("a 2 MiB schema body passes the global limit (then fails auth, not size)", async () => {
    expect((await post("/api/workspaces/jane/schema/inspect", 2 * MiB)).status).toBe(401);
  });

  test("over 6 MiB is still 413", async () => {
    const res = await post("/api/workspaces/jane/schema/inspect", 6 * MiB + 1);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "PAYLOAD_TOO_LARGE",
    );
  });

  test("other routes keep the 1 MiB limit", async () => {
    expect((await post("/api/auth/refresh", 2 * MiB)).status).toBe(413);
  });
});
