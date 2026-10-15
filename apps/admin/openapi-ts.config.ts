import { defineConfig } from '@hey-api/openapi-ts';
import { loadEnv } from 'vite';

const env = loadEnv('development', process.cwd(), '');

if (!env.VITE_APP_API_ENDPOINT) {
  throw new Error(
    'VITE_APP_API_ENDPOINT is not set. Add it to .env.development before running codegen.',
  );
}

export default defineConfig({
  input: `${env.VITE_APP_API_ENDPOINT}/api/openapi.json`,
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
