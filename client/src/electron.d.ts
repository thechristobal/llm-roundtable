export {}

declare global {
  interface Window {
    electronAPI?: {
      serverPort: number
      getProviderStatus: () => Promise<{
        openai: boolean
        anthropic: boolean
        gemini: boolean
        codexAuth: boolean
      }>
      setApiKey: (provider: string, key: string) => Promise<void>
      deleteApiKey: (provider: string) => Promise<void>
      checkCodexAuth: () => Promise<boolean>
      openCodexLoginInstructions: () => Promise<void>
    }
  }
}
