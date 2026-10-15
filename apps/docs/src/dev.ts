import { watch } from "node:fs";
import { join } from "node:path";
import { build } from "./build";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.DOCS_PORT ?? 4000);
const REBUILD_DEBOUNCE_MS = 100;

const reloadClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

function broadcastReload(): void {
  const payload = new TextEncoder().encode("event: reload\ndata: now\n\n");
  for (const controller of reloadClients) {
    try {
      controller.enqueue(payload);
    } catch {
      reloadClients.delete(controller);
    }
  }
}

let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
let building = false;

function scheduleRebuild(reason: string): void {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(async () => {
    if (building) return scheduleRebuild(reason);
    building = true;
    try {
      await build({ dev: true });
      broadcastReload();
    } catch (error) {
      console.error(`[docs] rebuild failed (${reason}):`, error);
    } finally {
      building = false;
    }
  }, REBUILD_DEBOUNCE_MS);
}

await build({ dev: true });

// src/ changes restart the whole process via `bun --watch`; content and assets
// only need a rebuild + browser reload.
for (const dir of ["content", "assets"]) {
  watch(join(ROOT, dir), { recursive: true }, (_event, filename) => {
    scheduleRebuild(`${dir}/${filename ?? ""}`);
  });
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/__reload") {
      let client: ReadableStreamDefaultController<Uint8Array> | undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          client = controller;
          reloadClients.add(controller);
        },
        cancel() {
          if (client) reloadClients.delete(client);
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
        },
      });
    }

    const path = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
    const file = Bun.file(join(DIST, path));
    if (await file.exists()) {
      return new Response(file, { headers: { "cache-control": "no-store" } });
    }
    // Clean-URL fallback: /section/page → /section/page/index.html
    const dirIndex = Bun.file(join(DIST, path, "index.html"));
    if (await dirIndex.exists()) {
      return new Response(dirIndex, { headers: { "cache-control": "no-store" } });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`[docs] dev server → http://localhost:${PORT}`);
