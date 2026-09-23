import { app, BrowserWindow, ipcMain, safeStorage, shell, utilityProcess, type UtilityProcess } from 'electron'
import { autoUpdater } from 'electron-updater'
import net from 'net'
import path from 'path'
import fs from 'fs'
import os from 'os'

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
let serverProcess: UtilityProcess | null = null

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
}

async function startServer() {
  serverPort = await getFreePort()

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

  serverProcess = utilityProcess.fork(serverScript, [], { env, stdio: 'pipe' })
  serverProcess.stdout?.on('data', (d: Buffer) => process.stdout.write(`[server] ${d}`))
  serverProcess.stderr?.on('data', (d: Buffer) => process.stderr.write(`[server] ${d}`))
}

async function restartServer() {
  serverProcess?.kill()
  await new Promise(r => setTimeout(r, 150))
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

  return {
    openai: codexAuth || !!keys.openai,
    anthropic: !!keys.anthropic,
    gemini: !!keys.gemini,
    codexAuth,
  }
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
    win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
  }

  return win
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await startServer()
  createWindow()
  if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  serverProcess?.kill()
  if (process.platform !== 'darwin') app.quit()
})
