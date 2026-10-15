// Writes apps/ui/openapi.json — the input of the UI's hey-api codegen
// (`bun run openapi:dump`). Offline and deterministic: the test env defaults
// make env.ts parse without a .env, and the DB/Redis clients are lazy, so no
// connection is ever opened. Run it after any route or schema change.
// The setup import must stay first: ES modules evaluate in declaration order,
// so it fills process.env before env.ts parses it.
import "../tests/setup";
import { join } from "node:path";
import { createApp } from "@/app";
import { env } from "@/config/env";

const res = await createApp({ docsEnabled: true }).request(`${env.API_BASE_PATH}/openapi.json`);
if (!res.ok) throw new Error(`GET /openapi.json returned ${res.status}`);
const spec: unknown = await res.json();

const target = join(import.meta.dir, "../../ui/openapi.json");
await Bun.write(target, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`wrote ${target}`);
process.exit(0);
