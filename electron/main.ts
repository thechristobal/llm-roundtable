import { app, autoUpdater, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import net from 'net'
import path from 'path'
import fs from 'fs'
import os from 'os'

const CLAUDE_CLI_ENABLED = process.env.ROUNDTABLE_DISABLE_CLAUDE_CLI !== '1'
const CLAUDE_BIN = process.platform === 'win32' ? 'claude.cmd' : 'claude'

type ClaudeCliStatus = {
  present: boolean
  loggedIn: boolean
  authMethod?: string
  subscriptionType?: string
}

let claudeCliCache: ClaudeCliStatus = { present: false, loggedIn: false }

function detectClaudeCli(): Promise<ClaudeCliStatus> {
  return new Promise(resolve => {
    // Windows: .cmd shims require shell: true since Node 18.20.2 (CVE-2024-27980).
    const child = spawn(CLAUDE_BIN, ['auth', 'status'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
    })
    let stdout = ''
    child.stdout.on('data', d => { stdout += d })
    child.on('error', () => resolve({ present: false, loggedIn: false }))
    child.on('close', code => {
      if (code !== 0) { resolve({ present: true, loggedIn: false }); return }
      try {
        const data = JSON.parse(stdout) as {
          loggedIn?: boolean; authMethod?: string; subscriptionType?: string
        }
        resolve({
          present: true,
          loggedIn: !!data.loggedIn,
          authMethod: data.authMethod,
          subscriptionType: data.subscriptionType,
        })
      } catch {
        resolve({ present: true, loggedIn: false })
      }
    })
  })
}

function selectAnthropicBackend(
  hasStoredKey: boolean,
  cli: ClaudeCliStatus,
): 'cli' | 'api' | 'none' {
  if (hasStoredKey) return 'api'
  if (CLAUDE_CLI_ENABLED && cli.present && cli.loggedIn) return 'cli'
  return 'none'
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string

// ─── Key storage (DPAPI on Windows, Keychain on Mac) ─────────────────────────

const keysFilePath = () => path.join(app.getPath('userData'), 'provider-keys.json')

function readKeys(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(keysFilePath(), 'utf-8')) }
  catch { return {} }
}

function writeKeys(data: Record<string, string>): void {
  fs.writeFileSync(keysFilePath(), JSON.stringify(data, null, 2), { mode: 0o600 })
}

function decryptKey(encrypted: string): string {
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
}

// ─── API key validation ───────────────────────────────────────────────────────

async function validateApiKey(provider: string, key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    let res: Response
    if (provider === 'anthropic') {
      res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      })
    } else if (provider === 'gemini') {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`)
    } else if (provider === 'openai') {
      res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      })
    } else if (provider === 'typesafe') {
      // Jev has no lightweight /models endpoint — probe with a trivial noul
      // question. Cost is negligible and this catches bad keys before save.
      res = await fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: { probe: true },
          model: 'jev-latest',
          questions: {
            probe: { type: 'noul', instructions: 'Probe.', criteria: { true: 't', false: 'f' } },
          },
        }),
      })
    } else {
      return { ok: false, error: `Unknown provider: ${provider}` }
    }
    if (!res.ok) return { ok: false, error: `Invalid key (HTTP ${res.status})` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Validation failed' }
  }
}

// ─── Server process ───────────────────────────────────────────────────────────

let serverPort = 0
let serverProcess: ChildProcess | null = null

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

const PROVIDER_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GOOGLE_API_KEY',
  openai: 'OPENAI_API_KEY',
  typesafe: 'TYPESAFE_API_KEY',
}

async function startServer() {
  // Pick the port ONCE at first startup and reuse it across restarts. The
  // renderer reads window.electronAPI.serverPort synchronously at page load
  // and never re-fetches, so a fresh port after every key change would
  // silently orphan the renderer's API base URL.
  if (!serverPort) serverPort = await getFreePort()

  const serverScript = app.isPackaged
    ? path.join(process.resourcesPath, 'server.js')
    : path.resolve(app.getAppPath(), 'electron/resources/server.js')

  // In dev, inherit parent env so server's own dotenv can still find keys
  // from server/.env.local when running without stored credentials.
  // In packaged builds, start clean — only explicitly-stored keys are in scope.
  const env: NodeJS.ProcessEnv = app.isPackaged
    ? { PORT: String(serverPort), HOST: '127.0.0.1', NODE_ENV: 'production' }
    : { ...process.env, PORT: String(serverPort), HOST: '127.0.0.1', NODE_ENV: 'development' }

  const storedKeys = readKeys()
  for (const [provider, encrypted] of Object.entries(storedKeys)) {
    const envKey = PROVIDER_ENV[provider]
    if (!envKey) continue
    try { env[envKey] = decryptKey(encrypted) }
    catch { /* skip corrupt entry */ }
  }

  claudeCliCache = await detectClaudeCli()
  env.ROUNDTABLE_CLAUDE_BACKEND = selectAnthropicBackend(!!storedKeys.anthropic, claudeCliCache)

  // utilityProcess.fork can't bind TCP sockets on Windows (UV_UNKNOWN on
  // listen), so run the server as a plain Node process by re-executing the
  // Electron binary with ELECTRON_RUN_AS_NODE=1. Same runtime, works.
  serverProcess = spawn(process.execPath, [serverScript], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  serverProcess.stdout?.on('data', (d: Buffer) => process.stdout.write(`[server] ${d}`))
  serverProcess.stderr?.on('data', (d: Buffer) => process.stderr.write(`[server] ${d}`))
  serverProcess.on('spawn', () => console.log(`[server] child process spawned pid=${serverProcess?.pid}`))
  serverProcess.on('exit', code => console.warn(`[server] child process exited code=${code}`))
}

async function restartServer() {
  // Wait for the old process to actually exit before spawning a new one — a
  // bare setTimeout wasn't long enough on Windows, so the new server would
  // race the old one's still-bound socket and fail with EADDRINUSE. The exit
  // event fires only after the OS releases the listening socket.
  if (serverProcess && serverProcess.exitCode === null) {
    const p = serverProcess
    await new Promise<void>(resolve => {
      p.once('exit', () => resolve())
      p.kill()
    })
  }
  serverProcess = null
  await startServer()
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.on('get-server-port', event => { event.returnValue = serverPort })

ipcMain.handle('get-provider-status', async () => {
  const keys = readKeys()
  const codexPath = path.join(os.homedir(), '.codex', 'auth.json')
  let codexAuth = false
  try {
    const auth = JSON.parse(fs.readFileSync(codexPath, 'utf-8'))
    codexAuth = !!(auth.tokens?.access_token || auth.apiKey)
  } catch { /* not logged in */ }

  const anthropicConnected = !!keys.anthropic || (CLAUDE_CLI_ENABLED && claudeCliCache.present && claudeCliCache.loggedIn)

  return {
    openai: codexAuth || !!keys.openai,
    anthropic: anthropicConnected,
    anthropicKey: !!keys.anthropic,
    gemini: !!keys.gemini,
    typesafe: !!keys.typesafe,
    codexAuth,
    claudeCli: claudeCliCache,
    cliEnabled: CLAUDE_CLI_ENABLED,
  }
})

ipcMain.handle('refresh-claude-cli', async () => {
  claudeCliCache = await detectClaudeCli()
  const keys = readKeys()
  const newBackend = selectAnthropicBackend(!!keys.anthropic, claudeCliCache)
  // Restart server so the backend env var takes effect for subsequent requests
  await restartServer()
  return { claudeCli: claudeCliCache, backend: newBackend }
})

ipcMain.handle('open-claude-cli-install-instructions', async () => {
  await shell.openExternal('https://docs.claude.com/en/docs/claude-code/quickstart')
})

ipcMain.handle('set-api-key', async (_e, provider: string, key: string) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Encryption not available on this system')
  const result = await validateApiKey(provider, key)
  if (!result.ok) throw new Error(result.error ?? 'Key validation failed')
  const keys = readKeys()
  keys[provider] = safeStorage.encryptString(key).toString('base64')
  writeKeys(keys)
  await restartServer()
})

ipcMain.handle('delete-api-key', async (_e, provider: string) => {
  const keys = readKeys()
  delete keys[provider]
  writeKeys(keys)
  await restartServer()
})

ipcMain.handle('check-codex-auth', async () => {
  const codexPath = path.join(os.homedir(), '.codex', 'auth.json')
  try {
    const auth = JSON.parse(fs.readFileSync(codexPath, 'utf-8'))
    return !!(auth.tokens?.access_token || auth.apiKey)
  } catch { return false }
})

ipcMain.handle('open-codex-login-instructions', async () => {
  await shell.openExternal('https://chatgpt.com')
})

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    // client/vite.config.ts sets root: client/, so Forge's Vite plugin writes
    // the renderer bundle to client/.vite/renderer/<name>/ (not the standard
    // project-root .vite/renderer/). __dirname in packaged app is
    // resources/app.asar/.vite/build/, so we back out two levels and dive
    // into client/.vite/renderer/<name>/.
    win.loadFile(path.join(__dirname, '..', '..', 'client', '.vite', 'renderer', MAIN_WINDOW_VITE_NAME, 'index.html'))
  }

  return win
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

function initAutoUpdater() {
  if (!app.isPackaged || process.platform !== 'win32') return
  const feedURL = `https://update.electronjs.org/thechristobal/llm-roundtable/win32-${process.arch}/${app.getVersion()}`
  autoUpdater.setFeedURL({ url: feedURL })
  autoUpdater.on('error', err => console.warn('[autoUpdater]', err.message))
  autoUpdater.on('update-downloaded', () => {
    // Squirrel silently applies the staged update on the next natural app quit.
    // No dialog, no forced restart — user sees the new version on their next launch.
    console.log('[autoUpdater] update staged; will apply on next quit')
  })
  autoUpdater.checkForUpdates()
}

app.whenReady().then(async () => {
  await startServer()
  createWindow()
  initAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  serverProcess?.kill()
  if (process.platform !== 'darwin') app.quit()
})
