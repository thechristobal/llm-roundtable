// Hosted-mode fetch helpers.
//
// mintToken(): POST Turnstile token → bearer JWT (short-lived, stored by caller).
// fetchDebateStream(): POST a debate request → consume NDJSON StreamEvents.
//
// Wire shape mirrors aws-lambda/src/types.ts:StreamEvent exactly. We don't
// import that type across the Electron/web boundary because the client bundle
// shouldn't take a dep on aws-lambda; the duplication is cheap and gives us
// a stable contract.
import type { ProviderID } from '../types'
import { getBearer, getByoKeys } from './hostedAuth'

export type ProviderError = { category: string; message: string; retryable: boolean }

export type StreamEvent =
  | { type: 'start'; ts: number }
  | { type: 'heartbeat'; ts: number }
  | { type: 'provider_complete'; provider: ProviderID; ok: true; content: string; model: string }
  | { type: 'provider_complete'; provider: ProviderID; ok: false; error: ProviderError }
  | { type: 'done'; ts: number }
  | { type: 'error'; message: string; category: string }

export class HostedApiError extends Error {
  readonly status: number
  readonly category: string
  constructor(status: number, category: string, message: string) {
    super(message)
    this.name = 'HostedApiError'
    this.status = status
    this.category = category
  }
}

export async function mintToken(turnstileToken: string): Promise<string> {
  const res = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ turnstileToken }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new HostedApiError(res.status, 'token_mint_failed', text || `Token mint failed (${res.status})`)
  }
  const data = await res.json() as { token?: string }
  if (!data.token) throw new HostedApiError(500, 'token_mint_failed', 'Token mint response missing token')
  return data.token
}

export type DebateRoundWire = {
  trigger: 'initial' | 'fight' | 'seek_consensus' | 'follow_up'
  prompt: string | null
  responses: Record<string, string | null>
}

export type DebateRequest = {
  action: 'opening' | 'fight' | 'seek_consensus' | 'follow_up'
  prompt: string
  rounds: DebateRoundWire[]
}

// Parse a chunked NDJSON stream line-by-line, forwarding each event to onEvent.
// Yields nothing — invoke the callback for side effects. Rejects on network
// error, 401/403 (so the caller can clear the stale bearer), or malformed JSON
// chunks.
export async function fetchDebateStream(
  request: DebateRequest,
  onEvent: (evt: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const bearer = getBearer()
  if (!bearer) throw new HostedApiError(401, 'auth', 'No bearer token')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${bearer}`,
  }
  const keys = getByoKeys()
  if (keys.openai) headers['X-Openai-Key'] = keys.openai
  if (keys.anthropic) headers['X-Anthropic-Key'] = keys.anthropic
  if (keys.google) headers['X-Google-Key'] = keys.google

  const res = await fetch('/api/debate', {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal,
  })

  if (res.status === 401 || res.status === 403) {
    throw new HostedApiError(res.status, 'auth', 'Session expired')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new HostedApiError(res.status, 'http', text || `HTTP ${res.status}`)
  }
  if (!res.body) {
    throw new HostedApiError(500, 'stream', 'Response has no body')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // Dispatch each complete line. Keep the trailing partial in buffer.
    let newlineIdx: number
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim()
      buffer = buffer.slice(newlineIdx + 1)
      if (!line) continue
      try {
        onEvent(JSON.parse(line) as StreamEvent)
      } catch {
        // Skip malformed line and keep draining — a broken frame mid-stream
        // shouldn't abort the whole exchange.
      }
    }
  }
  // Flush any trailing fragment (debate handler always ends with "\n", so this
  // is only hit on a truncated connection — treat as end-of-stream).
  const tail = buffer.trim()
  if (tail) {
    try { onEvent(JSON.parse(tail) as StreamEvent) } catch { /* drop */ }
  }
}
