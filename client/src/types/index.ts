export type ProviderID = 'openai' | 'anthropic' | 'google'

export type ProviderConfig = {
  id: ProviderID
  name: string
  model: string
  accentColor: string
}

export const PROVIDERS: Record<ProviderID, ProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'ChatGPT',
    model: 'gpt-4o',
    accentColor: '#10a37f',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Claude',
    model: 'claude-sonnet-4-6',
    accentColor: '#d97757',
  },
  google: {
    id: 'google',
    name: 'Gemini',
    model: 'gemini-1.5-pro',
    accentColor: '#4285f4',
  },
}

export type PanelState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'complete'; content: string }
  | { status: 'error'; message: string }
