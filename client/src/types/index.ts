import type { AdapterErrorWire } from '../../../shared/adapter-errors'

export type { ProviderID } from '../../../shared/providers'
import type { ProviderID } from '../../../shared/providers'

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
  | { status: 'error'; error: AdapterErrorWire }

export type DebateAction = 'fight' | 'follow_up' | 'seek_consensus'

export type JevDimScore = { score: number; confidence: number }

export type JevProviderRound = {
  reasoning: JevDimScore
  coherence: JevDimScore
  evidence: JevDimScore
  honesty: JevDimScore
  relevance: { noul: number; confidence: number }
  overall: number
  eqAnchored: boolean
  fabricationDetected: boolean
  contradictionDetected: boolean
  disqualified: boolean
  suspectedFabrication: string[]
}

export type JevRoundResult =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'complete'; providers: Partial<Record<ProviderID, JevProviderRound>>; mock: boolean }
  | { status: 'error'; message: string }

export type JevFinalResult =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'complete'; scores: Partial<Record<ProviderID, number>>; claimRisk: Partial<Record<ProviderID, number>>; winner: string; winnerConfidence: number; mock: boolean }
  | { status: 'error'; message: string }

export type Round = {
  trigger: 'initial' | DebateAction
  prompt: string | null
  panels: Record<ProviderID, PanelState>
}
