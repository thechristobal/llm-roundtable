import type { ProviderID } from '../../shared/providers.js'
import type { DebateAction, DebateRound } from '../../server/src/debatePrompt.js'

export type { ProviderID, DebateAction, DebateRound }

export interface DemoCredentials {
  openai?: string
  anthropic?: string
  google?: string
  typesafe?: string
}

export interface DebateRequestBody {
  action: DebateAction | 'opening'
  prompt: string
  rounds: DebateRound[]
}

export interface DemoSessionClaims {
  jti: string
  sub: string
  iat: number
  exp: number
}

export type ProviderCompleteEvent = {
  type: 'provider_complete'
  provider: ProviderID
  ok: true
  content: string
  model: string
} | {
  type: 'provider_complete'
  provider: ProviderID
  ok: false
  error: { category: string; message: string; retryable: boolean }
}

export type StreamEvent =
  | { type: 'start'; ts: number }
  | { type: 'heartbeat'; ts: number }
  | ProviderCompleteEvent
  | { type: 'done'; ts: number }
  | { type: 'error'; message: string; category: string }
