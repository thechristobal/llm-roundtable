import { contextBridge, ipcRenderer } from 'electron'
import type {
  AsyncArgs,
  AsyncChannel,
  AsyncResult,
  ElectronAPI,
  SyncChannel,
  SyncResult,
} from '../shared/electron-ipc'

// Typed wrappers around ipcRenderer. `invokeAsync` and `sendSyncTyped` take a
// channel from the contract and give back the exact result type — no per-call
// `as Promise<T>` casts, no drift from what main.ts registered.
function invokeAsync<K extends AsyncChannel>(
  channel: K,
  ...args: AsyncArgs<K>
): Promise<AsyncResult<K>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<AsyncResult<K>>
}

function sendSyncTyped<K extends SyncChannel>(channel: K): SyncResult<K> {
  return ipcRenderer.sendSync(channel) as SyncResult<K>
}

// Fetched synchronously so React has the port before first render
const serverPort = sendSyncTyped('get-server-port')
const appVersion = sendSyncTyped('get-app-version')

const api: ElectronAPI = {
  serverPort,
  appVersion,
  getProviderStatus: () => invokeAsync('get-provider-status'),
  setApiKey: (provider, key) => invokeAsync('set-api-key', provider, key),
  deleteApiKey: provider => invokeAsync('delete-api-key', provider),
  checkCodexAuth: () => invokeAsync('check-codex-auth'),
  openCodexLoginInstructions: () => invokeAsync('open-codex-login-instructions'),
  refreshClaudeCli: () => invokeAsync('refresh-claude-cli'),
  openClaudeCliInstallInstructions: () => invokeAsync('open-claude-cli-install-instructions'),
}

contextBridge.exposeInMainWorld('electronAPI', api)
