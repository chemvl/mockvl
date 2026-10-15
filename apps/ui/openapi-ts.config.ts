import { defineConfig } from "@hey-api/openapi-ts";

// Input is the document dumped by `bun run openapi:dump` (repo root), so codegen
// is deterministic and needs no running server.
export default defineConfig({
  input: "./openapi.json",
  output: "src/client",
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript", "@hey-api/sdk", "@tanstack/react-query"],
});
