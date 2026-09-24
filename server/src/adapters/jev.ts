export const MODEL = 'jev-latest'

export type JevQuestion =
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } }

export type JevRequest = {
  state: unknown
  model: string
  questions: Record<string, JevQuestion>
}

export type JevAnswer = {
  type: 'score' | 'choice' | 'noul'
  score?: number
  choice?: string
  noul?: number
  probabilities?: Record<string, number>
  confidence?: number
}

export type JevResponse = {
  model: string
  answers: Record<string, JevAnswer>
  usage: { input_tokens: number; output_tokens: number }
  mock?: boolean
}

// Varied but stable mock scores on Jev's 0–9 scale (server adds 1 → displays as 1–10)
const MOCK_SCORES: Record<string, Record<string, number>> = {
  openai:    { reasoning: 4.8, coherence: 5.2, evidence: 4.6, honesty: 5.0, overall: 4.8 },
  anthropic: { reasoning: 5.8, coherence: 6.1, evidence: 5.5, honesty: 6.2, overall: 5.8 },
  google:    { reasoning: 4.2, coherence: 4.4, evidence: 4.0, honesty: 4.5, overall: 4.3 },
}

function mockScoreFor(key: string): number {
  for (const [provider, dims] of Object.entries(MOCK_SCORES)) {
    for (const [dim, val] of Object.entries(dims)) {
      if (key === `${provider}_${dim}` || key === `${provider}_overall`) return val
    }
  }
  return 5.5
}

function mockResponse(questions: Record<string, JevQuestion>): JevResponse {
  const answers: Record<string, JevAnswer> = {}
  for (const [key, q] of Object.entries(questions)) {
    if (q.type === 'score') {
      answers[key] = { type: 'score', score: mockScoreFor(key), confidence: 0.70 }
    } else if (q.type === 'choice') {
      const opts = Object.keys(q.criteria)
      // Derive the winner from the same mock overall scores that populate the
      // scorecard so Verdict can never contradict what the user sees. Falls
      // back to the first non-tie option only if there are no provider opts.
      const providerOpts = opts.filter(o => o !== 'tie')
      const scoreOf = (p: string) => mockScoreFor(`${p}_overall`)
      const winner = providerOpts.length
        ? providerOpts.reduce((best, cur) => (scoreOf(cur) > scoreOf(best) ? cur : best))
        : opts[0]
      const ranked = providerOpts.map(scoreOf).sort((a, b) => b - a)
      const margin = (ranked[0] ?? 0) - (ranked[1] ?? 0)
      const confidence = Math.max(0.35, Math.min(0.95, 0.5 + margin * 0.5))
      const even = (1 - confidence) / (opts.length - 1)
      const probs = Object.fromEntries(opts.map(o => [o, o === winner ? confidence : even]))
      answers[key] = { type: 'choice', choice: winner, confidence, probabilities: probs }
    } else {
      const noul = key.endsWith('_eq_burden') ? 0.7  // burden exists: EQ applies
               : key.endsWith('_fabrication') ? 0.1  // no fabrication
               : key.endsWith('_contradiction') ? 0.1  // no contradiction
               : 0.2
      answers[key] = { type: 'noul', noul, confidence: 0.70 }
    }
  }
  return {
    model: 'jev-latest (mock — TYPESAFE_API_KEY not set)',
    answers,
    usage: { input_tokens: 0, output_tokens: 0 },
    mock: true,
  }
}

export async function queryJev(request: JevRequest): Promise<JevResponse> {
  if (!process.env.TYPESAFE_API_KEY) {
    console.warn('[jev] No TYPESAFE_API_KEY — returning mock response')
    return mockResponse(request.questions)
  }

  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...request, model: MODEL }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Jev API ${res.status}: ${text}`)
  }

  return res.json() as Promise<JevResponse>
}
