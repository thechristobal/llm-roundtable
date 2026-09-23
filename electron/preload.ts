import { contextBridge, ipcRenderer } from 'electron'

type ClaudeCliStatus = {
  present: boolean
  loggedIn: boolean
  authMethod?: string
  subscriptionType?: string
}

type ProviderStatus = {
  openai: boolean; anthropic: boolean; anthropicKey: boolean
  gemini: boolean; codexAuth: boolean
  claudeCli: ClaudeCliStatus; cliEnabled: boolean
}

// Fetched synchronously so React has the port before first render
const serverPort: number = ipcRenderer.sendSync('get-server-port')

contextBridge.exposeInMainWorld('electronAPI', {
  serverPort,
  getProviderStatus: () =>
    ipcRenderer.invoke('get-provider-status') as Promise<ProviderStatus>,
  setApiKey: (provider: string, key: string) =>
    ipcRenderer.invoke('set-api-key', provider, key) as Promise<void>,
  deleteApiKey: (provider: string) =>
    ipcRenderer.invoke('delete-api-key', provider) as Promise<void>,
  checkCodexAuth: () =>
    ipcRenderer.invoke('check-codex-auth') as Promise<boolean>,
  openCodexLoginInstructions: () =>
    ipcRenderer.invoke('open-codex-login-instructions') as Promise<void>,
  refreshClaudeCli: () =>
    ipcRenderer.invoke('refresh-claude-cli') as Promise<{
      claudeCli: ClaudeCliStatus; backend: 'cli' | 'api' | 'none'
    }>,
  openClaudeCliInstallInstructions: () =>
    ipcRenderer.invoke('open-claude-cli-install-instructions') as Promise<void>,
})
