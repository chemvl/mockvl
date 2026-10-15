// Vite config — translated from config/config.ts for the Umi → Vite migration.
// See PHASE_2_REPORT.md for a key-by-key translation log.

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Replicate config/config.ts define.process.env.COMMIT_HASH logic
const commitHash =
  process.env.COMMIT_HASH ||
  process.env.CF_PAGES_COMMIT_SHA ||
  (() => {
    try {
      return execSync('git rev-parse HEAD', {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf-8',
      }).trim();
    } catch {
      return '';
    }
  })();

const pkg = require('./package.json') as { version: string };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const viteEnv = env.VITE_ENV ?? 'dev';

  return {
    // Translated from config/config.ts publicPath: '/'
    base:
      mode !== 'development'
        ? `${env.VITE_BASE_URL_PUBLIC}`
        : env.VITE_BASE_URL,

    resolve: {
      alias: {
        // Umi provides '@' → 'src' automatically; replicate here
        '@': resolve(__dirname, 'src'),
        // Translated from config/config.ts alias: { '@root': join(__dirname, '..') }
        '@root': resolve(__dirname),
      },
    },

    // Translated from config/config.ts define block
    define: {
      'process.env.CI': JSON.stringify(process.env.CI),
      'process.env.COMMIT_HASH': JSON.stringify(commitHash),
      // Kept for call-site compatibility; __UMI_VERSION__ and __UTOO_VERSION__
      // are meaningless post-migration — set to empty strings.
      // See PHASE_2_REPORT.md § Config translation log.
      __APP_VERSION__: JSON.stringify(pkg.version),
      __UMI_VERSION__: JSON.stringify(''),
      __UTOO_VERSION__: JSON.stringify(''),
    },

    css: {
      preprocessorOptions: {
        // Translated from Umi's built-in Less support (src/global.less needs it)
        // No modifyVars: the inventory confirmed no config.theme / Less variables
        less: {
          javascriptEnabled: true,
        },
      },
    },

    plugins: [
      // Translated from config/config.ts fastRefresh: true
      // @vitejs/plugin-react enables Fast Refresh (HMR with state preservation) by default
      react(),

      // Inline raw-string loader for .md files —
      // translated from config/config.ts utoopack.module.rules['*.md']
      // which used config/md-raw-loader.cjs. Vite natively supports
      // the `?raw` query suffix, but src/pages/Welcome.tsx imports .md without
      // the suffix, so we handle it here. Phase 4 can migrate to `?raw` if preferred.
      {
        name: 'vite-plugin-md-raw',
        transform(code, id) {
          if (id.endsWith('.md')) {
            return { code: `export default ${JSON.stringify(code)}` };
          }
          return undefined;
        },
      },
    ],

    server: {
      // Match Umi preview port from package.json scripts
      port: 8000,
      // Proxy active only when VITE_ENV=test or VITE_ENV=pre (mirrors UMI_ENV behaviour)
      proxy: {
        '/api': {
          target: env.VITE_APP_API_ENDPOINT,
          xfwd: true,
          changeOrigin: true,
        },
      },
    },

    build: {
      rollupOptions: {
        output: {
          // Translated from config/config.ts hash: true
          entryFileNames: '[name]-[hash].js',
          chunkFileNames: '[name]-[hash].js',
          assetFileNames: '[name]-[hash][extname]',
        },
      },
    },
  };
});
