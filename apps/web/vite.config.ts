import { defineConfig, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Shared Vite config used by both CE and EE builds. */
export function createBaseConfig(overrides?: Partial<UserConfig>) {
  return defineConfig({
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: false,
          secure: false,
          cookieDomainRewrite: 'localhost',
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
