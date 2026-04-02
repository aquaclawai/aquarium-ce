import { defineConfig, mergeConfig } from 'vite'
import { createBaseConfig } from './vite.config.ts'

export default mergeConfig(createBaseConfig(), defineConfig({
  define: {
    'import.meta.env.VITE_EDITION': JSON.stringify('ce'),
  },
}))
