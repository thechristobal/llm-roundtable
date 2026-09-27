export type AdapterErrorCategory =
  | 'quota'
  | 'overloaded'
  | 'auth'
  | 'timeout'
  | 'malformed'
  | 'invalid_request'
  | 'unknown'

// 'server' covers errors that originated in the API layer itself
// (validation, unknown route params) rather than an upstream provider.
export type AdapterProvider = 'openai' | 'anthropic' | 'google' | 'jev' | 'server'

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
