export type ProviderID = 'openai' | 'anthropic' | 'google'

export type ProviderConfig = {
  id: ProviderID
  name: string
  accentColor: string
}

export const PROVIDERS: Record<ProviderID, ProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'ChatGPT',
    accentColor: '#10a37f',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Claude',
    accentColor: '#d97757',
  },
  google: {
    id: 'google',
    name: 'Gemini',
    accentColor: '#4285f4',
  },
}

export type PanelState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'complete'; content: string; durationMs: number; model?: string }
  | { status: 'error'; message: string }

export type DebateAction = 'fight' | 'follow_up' | 'seek_consensus'

export type Round = {
  trigger: 'initial' | DebateAction
  prompt: string | null
  panels: Record<ProviderID, PanelState>
}
