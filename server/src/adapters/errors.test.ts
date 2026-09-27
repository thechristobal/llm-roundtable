import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  AdapterError,
  classifyAnthropicCliStatus,
  classifyAnthropicError,
  classifyGoogleError,
  classifyOpenAIError,
  defaultRetryable,
  parseRetryAfter,
  toHttpStatus,
  toWire,
} from './errors.js'

describe('defaultRetryable', () => {
  it('quota without retryAfterMs → false', () => {
    expect(defaultRetryable('quota', undefined)).toBe(false)
  })
  it('quota with retryAfterMs → true (even 0 counts as a signal)', () => {
    expect(defaultRetryable('quota', 5000)).toBe(true)
    expect(defaultRetryable('quota', 0)).toBe(true)
  })
  it('overloaded → true', () => {
    expect(defaultRetryable('overloaded', undefined)).toBe(true)
  })
  it('timeout → true', () => {
    expect(defaultRetryable('timeout', undefined)).toBe(true)
  })
  it('auth → false', () => {
    expect(defaultRetryable('auth', undefined)).toBe(false)
  })
  it('malformed → false', () => {
    expect(defaultRetryable('malformed', undefined)).toBe(false)
  })
  it('unknown → false', () => {
    expect(defaultRetryable('unknown', undefined)).toBe(false)
  })
})

describe('toHttpStatus', () => {
  it.each([
    ['quota', 429],
    ['overloaded', 503],
    ['auth', 401],
    ['timeout', 504],
    ['malformed', 502],
    ['unknown', 500],
  ] as const)('%s → %d', (cat, status) => {
    expect(toHttpStatus(cat)).toBe(status)
  })
})

describe('toWire', () => {
  it('omits retryAfterMs when undefined; omits cause and stack', () => {
    const err = new AdapterError({
      category: 'auth',
      provider: 'anthropic',
      message: 'not configured',
      cause: new Error('boom'),
    })
    const wire = toWire(err)
    expect(wire).toEqual({
      category: 'auth',
      provider: 'anthropic',
      message: 'not configured',
      retryable: false,
    })
    expect(wire).not.toHaveProperty('cause')
    expect(wire).not.toHaveProperty('stack')
    expect(wire).not.toHaveProperty('retryAfterMs')
  })

  it('includes retryAfterMs when set (including 0)', () => {
    const err = new AdapterError({
      category: 'quota',
      provider: 'openai',
      message: 'rate limited',
      retryAfterMs: 0,
    })
    expect(toWire(err).retryAfterMs).toBe(0)
    expect(toWire(err).retryable).toBe(true)
  })
})

describe('parseRetryAfter', () => {
  it('undefined/null/empty → undefined', () => {
    expect(parseRetryAfter(undefined)).toBeUndefined()
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter('')).toBeUndefined()
    expect(parseRetryAfter('   ')).toBeUndefined()
  })

  it('positive integer seconds → ms', () => {
    expect(parseRetryAfter('30')).toBe(30000)
    expect(parseRetryAfter('1')).toBe(1000)
  })

  it('"0" → 0 ms (retry immediately)', () => {
    expect(parseRetryAfter('0')).toBe(0)
  })

  it('negative → undefined', () => {
    expect(parseRetryAfter('-5')).toBeUndefined()
    expect(parseRetryAfter('-0.5')).toBeUndefined()
  })

  it('fractional seconds → rounded ms', () => {
    expect(parseRetryAfter('1.5')).toBe(1500)
    expect(parseRetryAfter('0.001')).toBe(1)
  })

  it('non-numeric garbage → undefined', () => {
    expect(parseRetryAfter('banana')).toBeUndefined()
    expect(parseRetryAfter('30s')).toBeUndefined()
    expect(parseRetryAfter('30 seconds')).toBeUndefined()
  })

  describe('HTTP-date form', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('future HTTP-date → correct ms delta', () => {
      const result = parseRetryAfter('Thu, 15 Jan 2026 12:01:00 GMT')
      expect(result).toBe(60_000)
    })

    it('past HTTP-date → undefined', () => {
      const result = parseRetryAfter('Thu, 15 Jan 2026 11:59:00 GMT')
      expect(result).toBeUndefined()
    })

    it('present HTTP-date (delta = 0) → undefined', () => {
      const result = parseRetryAfter('Thu, 15 Jan 2026 12:00:00 GMT')
      expect(result).toBeUndefined()
    })
  })
})

describe('classifyAnthropicError', () => {
  const anth = (status: number | undefined, headers?: Record<string, string>) => {
    const e: Error & { status?: number; headers?: Record<string, string> } =
      Object.assign(new Error(`anthropic status=${status}`), { status, headers })
    return e
  }

  it('429 → quota, retryable=false, retryAfterMs=undefined', () => {
    const result = classifyAnthropicError(anth(429))
    expect(result.category).toBe('quota')
    expect(result.retryable).toBe(false)
    expect(result.retryAfterMs).toBeUndefined()
    expect(result.provider).toBe('anthropic')
  })

  it('429 + Retry-After: "30" → quota, retryable=true, retryAfterMs=30000', () => {
    const result = classifyAnthropicError(anth(429, { 'retry-after': '30' }))
    expect(result.category).toBe('quota')
    expect(result.retryable).toBe(true)
    expect(result.retryAfterMs).toBe(30000)
  })

  it('429 + Retry-After: "0" → quota, retryable=true, retryAfterMs=0', () => {
    const result = classifyAnthropicError(anth(429, { 'retry-after': '0' }))
    expect(result.category).toBe('quota')
    expect(result.retryable).toBe(true)
    expect(result.retryAfterMs).toBe(0)
  })

  it('429 + Retry-After: "banana" → quota, retryable=false, retryAfterMs=undefined', () => {
    const result = classifyAnthropicError(anth(429, { 'retry-after': 'banana' }))
    expect(result.category).toBe('quota')
    expect(result.retryable).toBe(false)
    expect(result.retryAfterMs).toBeUndefined()
  })

  it('529 → overloaded, retryable=true', () => {
    const result = classifyAnthropicError(anth(529))
    expect(result.category).toBe('overloaded')
    expect(result.retryable).toBe(true)
  })

  it('503 → overloaded, retryable=true', () => {
    expect(classifyAnthropicError(anth(503)).category).toBe('overloaded')
  })

  it('401 → auth, retryable=false', () => {
    const result = classifyAnthropicError(anth(401))
    expect(result.category).toBe('auth')
    expect(result.retryable).toBe(false)
  })

  it('403 → auth', () => {
    expect(classifyAnthropicError(anth(403)).category).toBe('auth')
  })

  it('500 → unknown, retryable=false', () => {
    const result = classifyAnthropicError(anth(500))
    expect(result.category).toBe('unknown')
    expect(result.retryable).toBe(false)
  })

  it('no-status object → unknown', () => {
    expect(classifyAnthropicError({ message: 'weird' }).category).toBe('unknown')
  })

  it('preserves cause on the AdapterError instance', () => {
    const raw = anth(500)
    const result = classifyAnthropicError(raw)
    expect((result as { cause?: unknown }).cause).toBe(raw)
  })
})

describe('classifyOpenAIError', () => {
  const oai = (status: number | undefined, headers?: Record<string, string>) =>
    Object.assign(new Error(`openai status=${status}`), { status, headers })

  it('429 → quota', () => {
    expect(classifyOpenAIError(oai(429)).category).toBe('quota')
  })
  it('429 + Retry-After: "10" → retryable=true, retryAfterMs=10000', () => {
    const r = classifyOpenAIError(oai(429, { 'retry-after': '10' }))
    expect(r.retryable).toBe(true)
    expect(r.retryAfterMs).toBe(10000)
  })
  it('401 → auth', () => {
    expect(classifyOpenAIError(oai(401)).category).toBe('auth')
  })
  it('403 → auth', () => {
    expect(classifyOpenAIError(oai(403)).category).toBe('auth')
  })
  it('503 → overloaded', () => {
    expect(classifyOpenAIError(oai(503)).category).toBe('overloaded')
  })
  it('502 → overloaded (Bad Gateway = transient capacity issue)', () => {
    expect(classifyOpenAIError(oai(502)).category).toBe('overloaded')
  })
  it('500 → unknown (not blindly classified as overloaded)', () => {
    expect(classifyOpenAIError(oai(500)).category).toBe('unknown')
  })
  it('provider defaults to openai; overridable', () => {
    const r = classifyOpenAIError(oai(429), 'openai')
    expect(r.provider).toBe('openai')
  })
})

describe('classifyGoogleError', () => {
  const g = (msg: string) => new Error(msg)

  it('"429 Too Many Requests" → quota', () => {
    expect(classifyGoogleError(g('429 Too Many Requests')).category).toBe('quota')
  })
  it('"RESOURCE_EXHAUSTED: ..." → quota', () => {
    expect(classifyGoogleError(g('RESOURCE_EXHAUSTED: quota reached')).category).toBe('quota')
  })
  it('"503 Service Unavailable" → overloaded', () => {
    expect(classifyGoogleError(g('503 Service Unavailable')).category).toBe('overloaded')
  })
  it('"The model is overloaded" → overloaded', () => {
    expect(classifyGoogleError(g('The model is overloaded, try again')).category).toBe('overloaded')
  })
  it('"high demand" → overloaded', () => {
    expect(classifyGoogleError(g('high demand right now')).category).toBe('overloaded')
  })
  it('"invalid API key" → auth', () => {
    expect(classifyGoogleError(g('invalid API key provided')).category).toBe('auth')
  })
  it('"API key not valid" → auth', () => {
    expect(classifyGoogleError(g('API key not valid. Please pass a valid key.')).category).toBe('auth')
  })
  it('"missing api key" → auth', () => {
    expect(classifyGoogleError(g('Request missing API key')).category).toBe('auth')
  })
  it('"unregistered caller" → auth', () => {
    expect(classifyGoogleError(g('The request is missing a valid API key or unregistered caller')).category).toBe('auth')
  })
  it('"unauthorized" → auth', () => {
    expect(classifyGoogleError(g('Unauthorized')).category).toBe('auth')
  })
  it('"unauthenticated" → auth', () => {
    expect(classifyGoogleError(g('Request had invalid authentication credentials — Unauthenticated')).category).toBe('auth')
  })
  it('"permission denied" → auth', () => {
    expect(classifyGoogleError(g('Permission denied on resource project')).category).toBe('auth')
  })
  it('bare "401" text alone → unknown (not auth)', () => {
    expect(classifyGoogleError(g('401')).category).toBe('unknown')
  })
  it('bare "403" text alone → unknown (not auth)', () => {
    expect(classifyGoogleError(g('403')).category).toBe('unknown')
  })
  it('random string → unknown', () => {
    expect(classifyGoogleError(g('something exploded in the model')).category).toBe('unknown')
  })
})

describe('classifyAnthropicCliStatus', () => {
  it('429 → quota', () => {
    expect(classifyAnthropicCliStatus(429, 'detail').category).toBe('quota')
  })
  it('529 → overloaded', () => {
    expect(classifyAnthropicCliStatus(529, 'detail').category).toBe('overloaded')
  })
  it('503 → overloaded', () => {
    expect(classifyAnthropicCliStatus(503, 'detail').category).toBe('overloaded')
  })
  it('401 → auth', () => {
    expect(classifyAnthropicCliStatus(401, 'detail').category).toBe('auth')
  })
  it('null → unknown', () => {
    expect(classifyAnthropicCliStatus(null, 'no status').category).toBe('unknown')
  })
  it('500 → unknown', () => {
    expect(classifyAnthropicCliStatus(500, 'server error').category).toBe('unknown')
  })
  it('provider is always anthropic', () => {
    expect(classifyAnthropicCliStatus(429, 'x').provider).toBe('anthropic')
  })
})

describe('AdapterError construction', () => {
  it('sets retryable from defaultRetryable when not provided', () => {
    const e = new AdapterError({ category: 'overloaded', provider: 'openai', message: 'x' })
    expect(e.retryable).toBe(true)
  })

  it('explicit retryable overrides default', () => {
    const e = new AdapterError({ category: 'overloaded', provider: 'openai', message: 'x', retryable: false })
    expect(e.retryable).toBe(false)
  })

  it('is an Error subclass with correct name', () => {
    const e = new AdapterError({ category: 'quota', provider: 'anthropic', message: 'x' })
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('AdapterError')
  })

  it('preserves message on both .message and Error.prototype', () => {
    const e = new AdapterError({ category: 'quota', provider: 'anthropic', message: 'rate limit hit' })
    expect(e.message).toBe('rate limit hit')
    expect(String(e)).toContain('rate limit hit')
  })
})
