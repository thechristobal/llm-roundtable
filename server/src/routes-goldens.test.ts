import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

// Pre-refactor pins for I1/I2: /api/judge/round + /api/judge/final wire shape.
// Feed a KNOWN answers object into a mocked queryJev and snapshot the JSON
// response the route emits. After Candidate 2 lands, the same input must
// yield the same output — enforced by these snapshots.

vi.mock('./adapters/openai.js', () => ({ askOpenAI: vi.fn() }))
vi.mock('./adapters/anthropic.js', () => ({ askAnthropic: vi.fn() }))
vi.mock('./adapters/google.js', () => ({ askGoogle: vi.fn() }))
vi.mock('./adapters/jev.js', () => ({ queryJev: vi.fn() }))

const { app } = await import('./index.js')
const { queryJev } = await import('./adapters/jev.js')

const PROVIDERS = ['openai', 'anthropic', 'google']

type RawAnswer = {
  type: 'score' | 'noul' | 'choice'
  score?: number
  noul?: number
  choice?: string
  confidence?: number
  probabilities?: Record<string, number>
}

function cleanRoundAnswers(providers: string[]): Record<string, RawAnswer> {
  const answers: Record<string, RawAnswer> = {}
  for (const p of providers) {
    answers[`${p}_reasoning`]     = { type: 'score', score: 4.0, confidence: 0.7 }
    answers[`${p}_coherence`]     = { type: 'score', score: 4.0, confidence: 0.7 }
    answers[`${p}_evidence`]      = { type: 'score', score: 4.0, confidence: 0.7 }
    answers[`${p}_honesty`]       = { type: 'score', score: 4.0, confidence: 0.7 }
    // eq_burden noul HIGH → burden exists → NOT eq-anchored (permissive default
    // otherwise triggers anchor; explicit HIGH keeps evidence at natural score)
    answers[`${p}_eq_burden`]     = { type: 'noul', noul: 0.9, confidence: 0.8 }
    answers[`${p}_contradiction`] = { type: 'noul', noul: 0.0, confidence: 0.9 }
    answers[`${p}_fabrication`]   = { type: 'noul', noul: 0.0, confidence: 0.9 }
    answers[`${p}_relevance`]     = { type: 'noul', noul: 0.0, confidence: 0.9 }
  }
  return answers
}

function fixedResponses(providers: string[]): Record<string, string> {
  return Object.fromEntries(providers.map(p => [p, `${p} response text`]))
}

describe('I1 golden — POST /api/judge/round wire shape', () => {
  beforeEach(() => { vi.mocked(queryJev).mockReset() })

  it('scenario A: all providers clean (no flags, no DQ) — pins base weighted-sum wire', async () => {
    vi.mocked(queryJev).mockResolvedValueOnce({
      model: 'jev-latest',
      answers: cleanRoundAnswers(PROVIDERS),
      usage: { input_tokens: 0, output_tokens: 0 },
      mock: false,
    })

    const res = await request(app).post('/api/judge/round').send({
      round: { trigger: 'initial', prompt: 'test prompt', responses: fixedResponses(PROVIDERS) },
      allProviders: PROVIDERS,
      isInitial: true,
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchSnapshot()
  })

  it('scenario B: openai contradiction cap fires (no fabrication → no locateFabrication reentry)', async () => {
    const answers = cleanRoundAnswers(PROVIDERS)
    answers['openai_contradiction'] = { type: 'noul', noul: 0.8, confidence: 0.9 }
    vi.mocked(queryJev).mockResolvedValueOnce({
      model: 'jev-latest',
      answers,
      usage: { input_tokens: 0, output_tokens: 0 },
      mock: false,
    })

    const res = await request(app).post('/api/judge/round').send({
      round: { trigger: 'followup', prompt: null, responses: fixedResponses(PROVIDERS) },
      allProviders: PROVIDERS,
      isInitial: false,
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchSnapshot()
  })

  it('scenario C: google disqualified via relevance gate (dim scores + overall untouched)', async () => {
    const answers = cleanRoundAnswers(PROVIDERS)
    answers['google_relevance'] = { type: 'noul', noul: 0.8, confidence: 0.9 }
    vi.mocked(queryJev).mockResolvedValueOnce({
      model: 'jev-latest',
      answers,
      usage: { input_tokens: 0, output_tokens: 0 },
      mock: false,
    })

    const res = await request(app).post('/api/judge/round').send({
      round: { trigger: 'initial', prompt: 'test prompt', responses: fixedResponses(PROVIDERS) },
      allProviders: PROVIDERS,
      isInitial: true,
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchSnapshot()
  })

  it('scenario D: openai eq-anchored (eq_burden.noul LOW → evidence boosted to 5.0)', async () => {
    const answers = cleanRoundAnswers(PROVIDERS)
    answers['openai_eq_burden'] = { type: 'noul', noul: 0.2, confidence: 0.8 }
    vi.mocked(queryJev).mockResolvedValueOnce({
      model: 'jev-latest',
      answers,
      usage: { input_tokens: 0, output_tokens: 0 },
      mock: false,
    })

    const res = await request(app).post('/api/judge/round').send({
      round: { trigger: 'initial', prompt: 'test prompt', responses: fixedResponses(PROVIDERS) },
      allProviders: PROVIDERS,
      isInitial: true,
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchSnapshot()
  })
})

describe('I2 golden — POST /api/judge/final wire shape', () => {
  beforeEach(() => { vi.mocked(queryJev).mockReset() })

  it('3 providers active, anthropic winner', async () => {
    const answers: Record<string, RawAnswer> = {}
    for (const p of PROVIDERS) {
      answers[`${p}_overall`]    = { type: 'score', score: 5.0, confidence: 0.8 }
      answers[`${p}_claim_risk`] = { type: 'noul', noul: 0.3, confidence: 0.7 }
    }
    answers['winner'] = {
      type: 'choice',
      choice: 'anthropic',
      confidence: 0.6,
      probabilities: { openai: 0.2, anthropic: 0.6, google: 0.2 },
    }
    vi.mocked(queryJev).mockResolvedValueOnce({
      model: 'jev-latest',
      answers,
      usage: { input_tokens: 0, output_tokens: 0 },
      mock: false,
    })

    const rounds = [{
      trigger: 'initial',
      prompt: 'test prompt',
      responses: fixedResponses(PROVIDERS),
    }]

    const res = await request(app).post('/api/judge/final').send({
      rounds,
      allProviders: PROVIDERS,
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchSnapshot()
  })
})
