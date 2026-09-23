export {}

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
  codexAuth: boolean
  claudeCli: ClaudeCliStatus
  cliEnabled: boolean
}

declare global {
  interface Window {
    electronAPI?: {
      serverPort: number
      getProviderStatus: () => Promise<ProviderStatus>
      setApiKey: (provider: string, key: string) => Promise<void>
      deleteApiKey: (provider: string) => Promise<void>
      checkCodexAuth: () => Promise<boolean>
      openCodexLoginInstructions: () => Promise<void>
      refreshClaudeCli: () => Promise<{ claudeCli: ClaudeCliStatus; backend: 'cli' | 'api' | 'none' }>
      openClaudeCliInstallInstructions: () => Promise<void>
    }
  }
}
