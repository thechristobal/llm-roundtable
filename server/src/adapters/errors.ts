import type {
  AdapterErrorCategory,
  AdapterErrorWire,
  AdapterProvider,
} from '../../../shared/adapter-errors.js'

export type { AdapterErrorCategory, AdapterErrorWire, AdapterProvider }

export interface AdapterErrorOptions {
  category: AdapterErrorCategory
  provider: AdapterProvider
  message: string
  retryable?: boolean
  retryAfterMs?: number
  cause?: unknown
}

export class AdapterError extends Error {
  readonly category: AdapterErrorCategory
  readonly provider: AdapterProvider
  readonly retryable: boolean
  readonly retryAfterMs?: number

  constructor(opts: AdapterErrorOptions) {
    super(opts.message)
    this.name = 'AdapterError'
    this.category = opts.category
    this.provider = opts.provider
    this.retryAfterMs = opts.retryAfterMs
    this.retryable = opts.retryable ?? defaultRetryable(opts.category, opts.retryAfterMs)
    if (opts.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause
    }
  }
}

export function defaultRetryable(
  category: AdapterErrorCategory,
  retryAfterMs?: number,
): boolean {
  switch (category) {
    case 'quota':
      return retryAfterMs !== undefined
    case 'overloaded':
    case 'timeout':
      return true
    case 'auth':
    case 'malformed':
    case 'unknown':
      return false
  }
}

export function toHttpStatus(category: AdapterErrorCategory): number {
  switch (category) {
    case 'quota': return 429
    case 'overloaded': return 503
    case 'auth': return 401
    case 'timeout': return 504
    case 'malformed': return 502
    case 'unknown': return 500
  }
}

export function toWire(err: AdapterError): AdapterErrorWire {
  const wire: AdapterErrorWire = {
    category: err.category,
    provider: err.provider,
    message: err.message,
    retryable: err.retryable,
  }
  if (err.retryAfterMs !== undefined) wire.retryAfterMs = err.retryAfterMs
  return wire
}

// Parses an HTTP Retry-After header value.
// - Numeric seconds: 0 is valid ("retry now"), negatives are rejected.
// - HTTP-date: past-or-equal is rejected.
// - Anything else → undefined.
export function parseRetryAfter(raw: string | undefined | null): number | undefined {
  if (raw === undefined || raw === null) return undefined
  const trimmed = raw.trim()
  if (trimmed === '') return undefined

  // Try numeric seconds first — must be an integer or float without other chars.
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const secs = Number(trimmed)
    if (Number.isNaN(secs) || secs < 0) return undefined
    return Math.round(secs * 1000)
  }

  // Fall through to HTTP-date parse
  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) return undefined
  const delta = parsed - Date.now()
  if (delta <= 0) return undefined
  return delta
}

type StatusBearing = { status?: number; headers?: Record<string, string> | undefined; message?: string }

function extractStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'status' in err) {
    const s = (err as StatusBearing).status
    if (typeof s === 'number') return s
  }
  return undefined
}

function extractRetryAfter(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'headers' in err) {
    const headers = (err as StatusBearing).headers
    if (headers) {
      // HTTP headers are case-insensitive; check common casings.
      const raw = headers['retry-after'] ?? headers['Retry-After']
      return parseRetryAfter(raw)
    }
  }
  return undefined
}

export function classifyAnthropicError(
  err: unknown,
  provider: AdapterProvider = 'anthropic',
): AdapterError {
  const msg = err instanceof Error ? err.message : String(err)
  const status = extractStatus(err)
  const retryAfterMs = extractRetryAfter(err)

  if (status === 429) {
    return new AdapterError({ category: 'quota', provider, message: msg, retryAfterMs, cause: err })
  }
  if (status === 529 || status === 503) {
    return new AdapterError({ category: 'overloaded', provider, message: msg, cause: err })
  }
  if (status === 401 || status === 403) {
    return new AdapterError({ category: 'auth', provider, message: msg, cause: err })
  }
  return new AdapterError({ category: 'unknown', provider, message: msg, cause: err })
}

export function classifyOpenAIError(
  err: unknown,
  provider: AdapterProvider = 'openai',
): AdapterError {
  const msg = err instanceof Error ? err.message : String(err)
  const status = extractStatus(err)
  const retryAfterMs = extractRetryAfter(err)

  if (status === 429) {
    return new AdapterError({ category: 'quota', provider, message: msg, retryAfterMs, cause: err })
  }
  if (status === 401 || status === 403) {
    return new AdapterError({ category: 'auth', provider, message: msg, cause: err })
  }
  if (status === 503 || status === 529 || status === 502) {
    return new AdapterError({ category: 'overloaded', provider, message: msg, cause: err })
  }
  return new AdapterError({ category: 'unknown', provider, message: msg, cause: err })
}

// Conservative auth-signal patterns for Google (SDK exposes message only).
// Matches clear language, NOT bare "401"/"403".
const GOOGLE_AUTH_PATTERNS: readonly RegExp[] = [
  /invalid.{0,30}(api.?key|credential|token)/i,
  /(api.?key|credential|token).{0,30}(invalid|missing|expired|not valid)/i,
  /missing.{0,30}api.?key/i,
  /unregistered caller/i,
  /unauthori[sz]ed/i,
  /unauthenticated/i,
  /permission.denied/i,
]

export function classifyGoogleError(
  err: unknown,
  provider: AdapterProvider = 'google',
): AdapterError {
  const msg = err instanceof Error ? err.message : String(err)

  if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) {
    return new AdapterError({ category: 'quota', provider, message: msg, cause: err })
  }
  if (/503|overloaded|high demand|service unavailable/i.test(msg)) {
    return new AdapterError({ category: 'overloaded', provider, message: msg, cause: err })
  }
  if (GOOGLE_AUTH_PATTERNS.some(re => re.test(msg))) {
    return new AdapterError({ category: 'auth', provider, message: msg, cause: err })
  }
  return new AdapterError({ category: 'unknown', provider, message: msg, cause: err })
}

// The Anthropic CLI returns a JSON blob with `api_error_status: number | null`
// instead of throwing a typed SDK error. Same status → category mapping.
export function classifyAnthropicCliStatus(
  status: number | null,
  message: string,
): AdapterError {
  if (status === 429) return new AdapterError({ category: 'quota', provider: 'anthropic', message })
  if (status === 529 || status === 503) return new AdapterError({ category: 'overloaded', provider: 'anthropic', message })
  if (status === 401 || status === 403) return new AdapterError({ category: 'auth', provider: 'anthropic', message })
  return new AdapterError({ category: 'unknown', provider: 'anthropic', message })
}
