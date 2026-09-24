import { Codex } from '@openai/codex-sdk'
import fs from 'fs'
import path from 'path'
import { OPENAI_MODEL } from '../models.js'

// esbuild bundles @openai/codex-sdk into electron/resources/server.js. The
// SDK's built-in resolver uses createRequire(import.meta.url), which after
// bundling is rooted at electron/resources/ — where @openai/codex* packages
// don't live (they're in server/node_modules/). Resolve the platform binary
// ourselves by walking up from __dirname AND process.cwd(), then pass via
// codexPathOverride so the SDK skips its own resolver entirely.
function platformPackageAndTriple(): { pkg: string; triple: string } | undefined {
  const arch = process.arch
  switch (process.platform) {
    case 'win32':
      return arch === 'arm64'
        ? { pkg: '@openai/codex-win32-arm64', triple: 'aarch64-pc-windows-msvc' }
        : { pkg: '@openai/codex-win32-x64', triple: 'x86_64-pc-windows-msvc' }
    case 'darwin':
      return arch === 'arm64'
        ? { pkg: '@openai/codex-darwin-arm64', triple: 'aarch64-apple-darwin' }
        : { pkg: '@openai/codex-darwin-x64', triple: 'x86_64-apple-darwin' }
    case 'linux':
      return arch === 'arm64'
        ? { pkg: '@openai/codex-linux-arm64', triple: 'aarch64-unknown-linux-musl' }
        : { pkg: '@openai/codex-linux-x64', triple: 'x86_64-unknown-linux-musl' }
    default:
      return undefined
  }
}

function candidateNodeModulesRoots(): string[] {
  const roots = new Set<string>()
  // Walk up from the bundled server.js location
  let dir = __dirname
  for (let i = 0; i < 10; i++) {
    roots.add(path.join(dir, 'node_modules'))
    roots.add(path.join(dir, 'server', 'node_modules'))
    // Packaged Electron: server.js sits in resources/, and the codex platform
    // package lives inside resources/app.asar.unpacked/server/node_modules
    // (unpacked because .exe files can't be spawned from asar's virtual FS).
    roots.add(path.join(dir, 'app.asar.unpacked', 'server', 'node_modules'))
    roots.add(path.join(dir, 'app.asar.unpacked', 'node_modules'))
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // Also try cwd (dev launches typically run from project root)
  roots.add(path.join(process.cwd(), 'server', 'node_modules'))
  roots.add(path.join(process.cwd(), 'node_modules'))
  return [...roots]
}

function findCodexBinary(): string | undefined {
  const p = platformPackageAndTriple()
  if (!p) return undefined
  const binName = process.platform === 'win32' ? 'codex.exe' : 'codex'
  for (const root of candidateNodeModulesRoots()) {
    const candidate = path.join(root, p.pkg, 'vendor', p.triple, 'bin', binName)
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
}

let codex: Codex | null = null
function getClient() {
  if (!codex) {
    const codexPathOverride = findCodexBinary()
    if (!codexPathOverride) {
      console.warn('[openai] Codex binary not found — SDK will attempt its own resolution and likely fail')
    }
    codex = new Codex({ codexPathOverride })
  }
  return codex
}

export async function askOpenAI(prompt: string, systemPrompt?: string): Promise<string> {
  const thread = getClient().startThread({ model: OPENAI_MODEL, skipGitRepoCheck: true })
  const fullPrompt = systemPrompt ? `[Context]\n${systemPrompt}\n\n[Question]\n${prompt}` : prompt
  const turn = await thread.run(fullPrompt)
  return turn.finalResponse ?? ''
}
