import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { AdapterError } from './adapters/errors.js'

// C3 characterization pins: every server error wire shape, before the
// centralized sendError/sendSuccess helpers land. Validation errors and
// adapter errors currently ship inconsistent shapes; these snapshots freeze
// the pre-refactor wire so the diff is explicit when C3 unifies it.

vi.mock('./adapters/openai.js', () => ({ askOpenAI: vi.fn() }))
vi.mock('./adapters/anthropic.js', () => ({ askAnthropic: vi.fn() }))
vi.mock('./adapters/google.js', () => ({ askGoogle: vi.fn() }))
vi.mock('./adapters/jev.js', () => ({ queryJev: vi.fn() }))

const { app } = await import('./index.js')
const { askOpenAI } = await import('./adapters/openai.js')
const { queryJev } = await import('./adapters/jev.js')

describe('C3 golden — validation error wire shapes', () => {
  it('POST /api/ask with missing prompt → 400', async () => {
    const res = await request(app).post('/api/ask').send({ provider: 'openai' })
    expect(res.status).toMatchSnapshot('status')
    expect(res.body).toMatchSnapshot('body')
  })

  it('POST /api/ask with unknown provider → 400', async () => {
    vi.mocked(askOpenAI).mockRejectedValueOnce(new Error('should not be called'))
    const res = await request(app).post('/api/ask').send({ provider: 'grok', prompt: 'hi' })
    expect(res.status).toMatchSnapshot('status')
    expect(res.body).toMatchSnapshot('body')
  })

  it('POST /api/debate/ask with missing rounds → 400', async () => {
    const res = await request(app).post('/api/debate/ask').send({ provider: 'openai', action: 'fight' })
    expect(res.status).toMatchSnapshot('status')
    expect(res.body).toMatchSnapshot('body')
  })

  it('POST /api/judge/round with missing round → 400', async () => {
    const res = await request(app).post('/api/judge/round').send({ allProviders: ['openai'] })
    expect(res.status).toMatchSnapshot('status')
    expect(res.body).toMatchSnapshot('body')
  })

  it('POST /api/judge/final with missing rounds → 400', async () => {
    const res = await request(app).post('/api/judge/final').send({ allProviders: ['openai'] })
    expect(res.status).toMatchSnapshot('status')
    expect(res.body).toMatchSnapshot('body')
  })
})

describe('C3 golden — adapter error wire shapes', () => {
  beforeEach(() => {
    vi.mocked(askOpenAI).mockReset()
    vi.mocked(queryJev).mockReset()
  })

  it('POST /api/ask when adapter throws AdapterError(quota) → 429 + typed wire', async () => {
    vi.mocked(askOpenAI).mockRejectedValueOnce(new AdapterError({
      category: 'quota',
      provider: 'openai',
      message: 'rate limited',
      retryAfterMs: 1500,
    }))
    const res = await request(app).post('/api/ask').send({ provider: 'openai', prompt: 'hi' })
    expect(res.status).toMatchSnapshot('status')
    expect(res.body).toMatchSnapshot('body')
  })

  it('POST /api/ask when adapter throws AdapterError(overloaded) → 503 + typed wire', async () => {
    vi.mocked(askOpenAI).mockRejectedValueOnce(new AdapterError({
      category: 'overloaded',
      provider: 'openai',
      message: 'try later',
    }))
    const res = await request(app).post('/api/ask').send({ provider: 'openai', prompt: 'hi' })
    expect(res.status).toMatchSnapshot('status')
    expect(res.body).toMatchSnapshot('body')
  })

  it('POST /api/ask when adapter throws plain Error → 500 + unknown-category wire', async () => {
    vi.mocked(askOpenAI).mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/ask').send({ provider: 'openai', prompt: 'hi' })
    expect(res.status).toMatchSnapshot('status')
    expect(res.body).toMatchSnapshot('body')
  })

  it('POST /api/judge/round when queryJev throws AdapterError(auth) → 401 + typed wire (jev provider)', async () => {
    vi.mocked(queryJev).mockRejectedValueOnce(new AdapterError({
      category: 'auth',
      provider: 'jev',
      message: 'bad key',
    }))
    const res = await request(app).post('/api/judge/round').send({
      round: { trigger: 'initial', prompt: 't', responses: { openai: 'x' } },
      allProviders: ['openai'],
      isInitial: true,
    })
    expect(res.status).toMatchSnapshot('status')
    expect(res.body).toMatchSnapshot('body')
  })
})
