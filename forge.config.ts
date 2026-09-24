import type { ForgeConfig } from '@electron-forge/shared-types'
import { mkdirSync } from 'fs'

// require() avoids jiti ESM/CJS interop issues with Forge maker/plugin classes
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MakerSquirrel } = require('@electron-forge/maker-squirrel')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AutoUnpackNativesPlugin } = require('@electron-forge/plugin-auto-unpack-natives')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { VitePlugin } = require('@electron-forge/plugin-vite')

const config: ForgeConfig = {
  packagerConfig: {
    // Unpack native binaries so Node can spawn them at runtime — spawning
    // executables from inside the asar virtual filesystem fails silently.
    // Covers @openai/codex-* (codex.exe, rg.exe, code-mode-host.exe) and
    // @anthropic-ai/claude-agent-sdk-* (claude.exe) platform packages.
    asar: { unpack: '**/*.{exe,dll,node,dylib,so}' },
    extraResource: ['electron/resources/server.js'],
    // Airtight blacklist so no local credentials, dotenv files, or auth blobs
    // ever enter the distributable. electron-packager passes each candidate
    // path (leading slash, forward-slash separators) to this predicate;
    // returning true excludes it.
    ignore: (filePath: string) => {
      if (!filePath) return false
      // dotenv family: .env, .env.local, .env.production, etc. at any depth
      if (/\/\.env($|\..+$)/.test(filePath)) return true
      // Codex CLI credential file if a user happened to symlink one into repo
      if (/\/auth\.json$/.test(filePath)) return true
      // Roundtable's own stored-key file (should live in userData, but paranoid)
      if (/\/provider-keys\.json$/.test(filePath)) return true
      // Vendored .claude/ folders (agent internals, transcripts, memory)
      if (/(^|\/)\.claude($|\/)/.test(filePath)) return true
      // Personal notes / docs not meant to ship
      if (/\.rtf$/.test(filePath)) return true
      if (/(^|\/)CONTEXT\.md$/.test(filePath)) return true
      // Renderer is bundled into .vite/renderer/main_window by vite; the raw
      // client/node_modules tree (~145 MB of React/Vite dev deps) is dead
      // weight in the packaged app.
      if (/^\/client\/node_modules($|\/)/.test(filePath)) return true
      // Local git history and Claude Code agent scratch space
      if (/^\/\.git($|\/)/.test(filePath)) return true
      if (/^\/\.agents($|\/)/.test(filePath)) return true
      return false
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ name: 'LLMRoundtable' }),
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
        // esbuild sets import_meta = {} in CJS mode, leaving import.meta.url undefined.
        // Replace every import.meta.url with _importMetaUrl, defined by the banner.
        define: { 'import.meta.url': '_importMetaUrl' },
        banner: { js: "var _importMetaUrl = require('url').pathToFileURL(__filename).href;" },
      })
      console.log('[roundtable] server bundle built → electron/resources/server.js')
    },
  },
}

export default config
