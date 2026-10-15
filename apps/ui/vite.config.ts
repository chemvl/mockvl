import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'
import * as path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  const backend = {
    target: env.VITE_APP_API_ENDPOINT || "http://localhost:3000",
    changeOrigin: true,
    xfwd: true,
  };

  // process.env VITE_* values take precedence over loadEnv file values,
  // allowing deploy scripts to inject the correct env via child process env
  for (const key of Object.keys(env)) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key]
    }
  }

  return {
    base: mode !== 'development' ? `${env.VITE_BASE_URL_PUBLIC}` : env.VITE_BASE_URL,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@ui': path.resolve(__dirname, 'src/components')
      }
    },
    plugins: [
      react(),
    ],
    esbuild: {
      // drop: mode === 'production' ? ['console', 'debugger'] : []
    },

    server: {
      // Regex keys: a plain "/m" prefix would also proxy SPA routes such as
      // "/marco" (a workspace slug) on reload.
      proxy: { "^/api/": backend, "^/m/": backend },
    },
    build: {
      minify: 'esbuild',
      target: 'es2015', // esbuild target
      assetsInlineLimit: 0, // source size limit
      sourcemap: false,
      rollupOptions: {
        output: {
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',
          assetFileNames: (assetInfo: { names?: readonly string[]; name?: string }) => {
            const name = assetInfo.names?.[0] ?? assetInfo.name ?? ''
            if (/\.css$/.test(name)) {
              return 'assets/[name]-[hash].[ext]'
            }
            if (/\.(woff2?|ttf|otf|eot)$/.test(name)) {
              return 'fonts/[name]-[hash].[ext]'
            }
            if (/\.(jpg|png|gif|jpeg|svg|webp|avif|ico)$/.test(name)) {
              return 'images/[name]-[hash].[ext]'
            }
            return 'assets/[name]-[hash].[ext]'
          }
        }
      }
    }
  }
})
