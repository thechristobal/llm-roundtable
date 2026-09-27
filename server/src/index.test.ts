import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { AdapterError, toHttpStatus, type AdapterErrorCategory } from './adapters/errors.js'

// Mock the three debater adapters BEFORE importing index.ts so vi.mock hoists.
vi.mock('./adapters/openai.js', () => ({ askOpenAI: vi.fn() }))
vi.mock('./adapters/anthropic.js', () => ({ askAnthropic: vi.fn() }))
vi.mock('./adapters/google.js', () => ({ askGoogle: vi.fn() }))
vi.mock('./adapters/jev.js', () => ({ queryJev: vi.fn() }))

const { app } = await import('./index.js')
const { askOpenAI } = await import('./adapters/openai.js')

const CATEGORIES: AdapterErrorCategory[] = ['quota', 'overloaded', 'auth', 'timeout', 'malformed', 'unknown']

describe('L3 wire-shape integration: /api/ask', () => {
  beforeEach(() => {
    vi.mocked(askOpenAI).mockReset()
  })

  it.each(CATEGORIES)(
    'AdapterError(category=%s) → HTTP %d with structured wire error',
    async (category) => {
      vi.mocked(askOpenAI).mockRejectedValueOnce(
        new AdapterError({ category, provider: 'openai', message: `stub ${category}` }),
      )

      const res = await request(app)
        .post('/api/ask')
        .send({ provider: 'openai', prompt: 'hi' })

      expect(res.status).toBe(toHttpStatus(category))
      expect(res.body).toEqual({
        error: {
          category,
          provider: 'openai',
          message: `stub ${category}`,
          retryable: category === 'overloaded' || category === 'timeout',
        },
      })
      // Wire shape must not leak diagnostics
      expect(res.body.error).not.toHaveProperty('cause')
      expect(res.body.error).not.toHaveProperty('stack')
    },
  )

  it('AdapterError with retryAfterMs is included in the wire response', async () => {
    vi.mocked(askOpenAI).mockRejectedValueOnce(
      new AdapterError({
        category: 'quota',
        provider: 'openai',
        message: 'rate limited',
        retryAfterMs: 30_000,
      }),
    )

    const res = await request(app)
      .post('/api/ask')
      .send({ provider: 'openai', prompt: 'hi' })

    expect(res.status).toBe(429)
    expect(res.body.error.retryable).toBe(true)
    expect(res.body.error.retryAfterMs).toBe(30_000)
  })

  it('non-AdapterError falls through to HTTP 500 + unknown wire shape', async () => {
    vi.mocked(askOpenAI).mockRejectedValueOnce(new Error('some raw error'))

    const res = await request(app)
      .post('/api/ask')
      .send({ provider: 'openai', prompt: 'hi' })

    expect(res.status).toBe(500)
    expect(res.body.error.category).toBe('unknown')
    expect(res.body.error.retryable).toBe(false)
  })
})

describe('L3 wire-shape integration: /api/debate/ask', () => {
  beforeEach(() => {
    vi.mocked(askOpenAI).mockReset()
  })

  it('AdapterError propagates through the debate endpoint with the same wire shape', async () => {
    vi.mocked(askOpenAI).mockRejectedValueOnce(
      new AdapterError({ category: 'overloaded', provider: 'openai', message: 'too busy' }),
    )

    const res = await request(app)
      .post('/api/debate/ask')
      .send({
        provider: 'openai',
        action: 'fight',
        rounds: [{ trigger: 'initial', prompt: 'p', responses: { openai: 'r' } }],
      })

    expect(res.status).toBe(503)
    expect(res.body.error).toEqual({
      category: 'overloaded',
      provider: 'openai',
      message: 'too busy',
      retryable: true,
    })
  })
})
