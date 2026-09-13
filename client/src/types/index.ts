export type ModelId = 'openai' | 'anthropic' | 'google'

export interface ModelConfig {
  id: ModelId
  name: string
  label: string
  accentColor: string
}

export const MODEL_CONFIGS = {
  openai: {
    id: 'openai',
    name: 'ChatGPT',
    label: 'GPT-4o',
    accentColor: '#10a37f',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Claude',
    label: 'Claude 3.5 Sonnet',
    accentColor: '#d97757',
  },
  google: {
    id: 'google',
    name: 'Gemini',
    label: 'Gemini 1.5 Pro',
    accentColor: '#4285f4',
  },
} as const satisfies Record<ModelId, ModelConfig>

export type MessageStatus = 'idle' | 'loading' | 'streaming' | 'complete' | 'error'

export type ModelResponse =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'streaming'; content: string }
  | { status: 'complete'; content: string }
  | { status: 'error'; message: string }

export type RoundtableResponses = Record<ModelId, ModelResponse>

export interface ChatRequest {
  prompt: string
  modelId: ModelId
}

export interface ChatResponse {
  content: string
}
