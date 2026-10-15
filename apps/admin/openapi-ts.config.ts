import { defineConfig } from '@hey-api/openapi-ts';

// Input is the document dumped by `bun run openapi:dump` (repo root) — the same
// spec apps/ui generates from — so codegen is deterministic and needs no
// running server (CI generates the gitignored src/client this way).
export default defineConfig({
  input: '../ui/openapi.json',
  output: 'src/client',
  plugins: [
    // Generated paths already carry the API_BASE_PATH prefix (/api/...), so the
    // client must stay origin-relative — never bake in the codegen host.
    { name: '@hey-api/client-fetch', baseUrl: false },
    '@hey-api/typescript',
    '@hey-api/sdk',
    {
      name: '@tanstack/react-query',
      queryOptions: true,
      queryKeys: true,
      mutationOptions: true,
    },
  ],
});
