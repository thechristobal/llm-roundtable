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
  openai:    { reasoning: 4.8, rebuttal: 4.4, coherence: 5.2, evidence: 4.6, honesty: 5.0, spirit: 4.9, overall: 4.8 },
  anthropic: { reasoning: 5.8, rebuttal: 5.4, coherence: 6.1, evidence: 5.5, honesty: 6.2, spirit: 5.6, overall: 5.8 },
  google:    { reasoning: 4.2, rebuttal: 4.6, coherence: 4.4, evidence: 4.0, honesty: 4.5, spirit: 4.3, overall: 4.3 },
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
      const winner = opts.find(o => o !== 'tie') ?? opts[0]
      const even = (1 - 0.55) / (opts.length - 1)
      const probs = Object.fromEntries(opts.map(o => [o, o === winner ? 0.55 : even]))
      answers[key] = { type: 'choice', choice: winner, confidence: 0.55, probabilities: probs }
    } else {
      answers[key] = { type: 'noul', noul: 0.2, confidence: 0.70 }
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
