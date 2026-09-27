export type AdapterErrorCategory =
  | 'quota'
  | 'overloaded'
  | 'auth'
  | 'timeout'
  | 'malformed'
  | 'unknown'

export type AdapterProvider = 'openai' | 'anthropic' | 'google' | 'jev'

export interface AdapterErrorWire {
  category: AdapterErrorCategory
  provider: AdapterProvider
  message: string
  retryable: boolean
  retryAfterMs?: number
}

export interface ApiErrorResponse {
  error: AdapterErrorWire
}
