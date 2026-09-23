import { contextBridge, ipcRenderer } from 'electron'

// Fetched synchronously so React has the port before first render
const serverPort: number = ipcRenderer.sendSync('get-server-port')

contextBridge.exposeInMainWorld('electronAPI', {
  serverPort,
  getProviderStatus: () =>
    ipcRenderer.invoke('get-provider-status') as Promise<{
      openai: boolean; anthropic: boolean; gemini: boolean; codexAuth: boolean
    }>,
  setApiKey: (provider: string, key: string) =>
    ipcRenderer.invoke('set-api-key', provider, key) as Promise<void>,
  deleteApiKey: (provider: string) =>
    ipcRenderer.invoke('delete-api-key', provider) as Promise<void>,
  checkCodexAuth: () =>
    ipcRenderer.invoke('check-codex-auth') as Promise<boolean>,
  openCodexLoginInstructions: () =>
    ipcRenderer.invoke('open-codex-login-instructions') as Promise<void>,
})
