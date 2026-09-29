// Single source of truth for the Electron IPC surface. Shared across the
// main process (registers handlers), the preload script (wraps invokes and
// exposes ElectronAPI on window.electronAPI), and the renderer (reads types
// via client/src/electron.d.ts).
//
// Before C5, each channel's name, args, and return type were hand-mirrored
// in three places: ipcMain.handle(...) in electron/main.ts, ipcRenderer
// .invoke(...) in electron/preload.ts, and the Window interface in
// client/src/electron.d.ts. Adding a channel required touching all three
// files with signatures that had to agree by convention. This module makes
// the contract the interface and the three sites its adapters.
//
// No electron dependency — pure types so every side can import safely.

export type ClaudeCliStatus = {
  present: boolean
  loggedIn: boolean
  authMethod?: string
  subscriptionType?: string
}

export type ProviderStatus = {
  openai: boolean
  anthropic: boolean
  anthropicKey: boolean
  gemini: boolean
  typesafe: boolean
  codexAuth: boolean
  claudeCli: ClaudeCliStatus
  cliEnabled: boolean
}

export type ClaudeBackend = 'cli' | 'api' | 'none'

export type RefreshClaudeCliResult = {
  claudeCli: ClaudeCliStatus
  backend: ClaudeBackend
}

// Async (ipcMain.handle / ipcRenderer.invoke) channel map. Each entry pins
// the exact args tuple and result type.
export type IpcAsyncContract = {
  'get-provider-status':                { args: []; result: ProviderStatus }
  'set-api-key':                        { args: [provider: string, key: string]; result: void }
  'delete-api-key':                     { args: [provider: string]; result: void }
  'check-codex-auth':                   { args: []; result: boolean }
  'open-codex-login-instructions':      { args: []; result: void }
  'refresh-claude-cli':                 { args: []; result: RefreshClaudeCliResult }
  'open-claude-cli-install-instructions': { args: []; result: void }
}

// Synchronous (ipcMain.on with event.returnValue / ipcRenderer.sendSync)
// channel map. Used at preload load to seed window.electronAPI values that
// must exist before React first renders.
export type IpcSyncContract = {
  'get-server-port': number
  'get-app-version': string
  'get-auth-token': string
}

export type AsyncChannel = keyof IpcAsyncContract
export type AsyncArgs<K extends AsyncChannel> = IpcAsyncContract[K]['args']
export type AsyncResult<K extends AsyncChannel> = IpcAsyncContract[K]['result']

export type SyncChannel = keyof IpcSyncContract
export type SyncResult<K extends SyncChannel> = IpcSyncContract[K]

// Renderer-facing surface exposed on window.electronAPI. Property names are
// the friendly method names (getProviderStatus, setApiKey, ...); each
// function type derives from the underlying async channel so a signature
// change in the contract propagates automatically. Sync-loaded fields
// (serverPort, appVersion) sit alongside.
export type ElectronAPI = {
  serverPort: SyncResult<'get-server-port'>
  appVersion: SyncResult<'get-app-version'>
  authToken: SyncResult<'get-auth-token'>
  getProviderStatus:                (...args: AsyncArgs<'get-provider-status'>) => Promise<AsyncResult<'get-provider-status'>>
  setApiKey:                        (...args: AsyncArgs<'set-api-key'>) => Promise<AsyncResult<'set-api-key'>>
  deleteApiKey:                     (...args: AsyncArgs<'delete-api-key'>) => Promise<AsyncResult<'delete-api-key'>>
  checkCodexAuth:                   (...args: AsyncArgs<'check-codex-auth'>) => Promise<AsyncResult<'check-codex-auth'>>
  openCodexLoginInstructions:       (...args: AsyncArgs<'open-codex-login-instructions'>) => Promise<AsyncResult<'open-codex-login-instructions'>>
  refreshClaudeCli:                 (...args: AsyncArgs<'refresh-claude-cli'>) => Promise<AsyncResult<'refresh-claude-cli'>>
  openClaudeCliInstallInstructions: (...args: AsyncArgs<'open-claude-cli-install-instructions'>) => Promise<AsyncResult<'open-claude-cli-install-instructions'>>
}
