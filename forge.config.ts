import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerZip } from '@electron-forge/maker-zip'
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { mkdirSync } from 'fs'

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: ['electron/resources/server.js'],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ name: 'LLMRoundtable' }),
    new MakerZip({}, ['darwin']),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        { entry: 'electron/main.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'electron/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [
        { name: 'main_window', config: 'client/vite.config.ts' },
      ],
    }),
  ],
  hooks: {
    generateAssets: async () => {
      const { build } = await import('esbuild')
      mkdirSync('electron/resources', { recursive: true })
      await build({
        entryPoints: ['server/src/index.ts'],
        bundle: true,
        platform: 'node',
        target: 'node20',
        outfile: 'electron/resources/server.js',
        format: 'cjs',
        external: ['fsevents'],
      })
      console.log('[roundtable] server bundle built → electron/resources/server.js')
    },
  },
}

export default config
