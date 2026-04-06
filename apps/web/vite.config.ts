import { defineConfig, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

/** Shared Vite config used by both CE and EE builds. */
export function createBaseConfig(overrides?: Partial<UserConfig>) {
  return defineConfig({
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_EDITION': JSON.stringify('ce'),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: false,
          secure: false,
          cookieDomainRewrite: 'localhost',
          // WS upgrades on /api/instances/*/ui are handled by the server's
          // upgrade listener. Vite needs ws:true to forward them.
          ws: true,
        },
        '/ws': {
          target: 'ws://localhost:3001',
          ws: true,
        },
      },
    },
    ...overrides,
  })
}

// Default export for backward compatibility (dev server, etc.)
export default createBaseConfig()
