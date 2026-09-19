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
    model: 'gpt-5.6-sol',
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
    model: 'gemini-3.6-flash',
    accentColor: '#4285f4',
  },
}

export type PanelState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'complete'; content: string; rounds: string[] }
  | { status: 'error'; message: string }

export type DebateMode = 'fight' | 'consensus' | 'devils-advocate' | 'fact-check'
