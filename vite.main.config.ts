import { defineConfig } from 'vite'
import { builtinModules } from 'node:module'

export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        'electron',
        'electron-updater',
        ...builtinModules,
        ...builtinModules.map(m => `node:${m}`),
      ],
    },
  },
})
