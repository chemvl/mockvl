import { Hono } from "hono";
import { MOCK_MOUNT_PATH } from "@/modules/mock-runtime/mock-app";

// Both the API (OpenAPIHono with a base path) and the mock app satisfy this.
type FetchApp = Pick<Hono, "fetch">;

// The process entry app: /m/* goes to the mock runtime, everything else to
// the API. mount() with replaceRequest:false hands each app the untouched
// request (full path), so each keeps its own routing, notFound and onError —
// the API's JSON envelopes never wrap a mock, and vice versa.
export function createRootApp(apps: { api: FetchApp; mock: FetchApp }): Hono {
  const root = new Hono();
  root.mount(MOCK_MOUNT_PATH, apps.mock.fetch, { replaceRequest: false });
  root.mount("/", apps.api.fetch, { replaceRequest: false });
  return root;
}
