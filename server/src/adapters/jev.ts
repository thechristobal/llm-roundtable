import { AdapterError, parseRetryAfter } from './errors.js'
import {
  DIMENSIONS, FLAGS,
  dimensionKey, flagKey, finalKey,
  type DimensionKey, type FlagKey,
} from '../../../shared/jev-rubric.js'
import type { ProviderID } from '../../../shared/providers.js'

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

// Varied but stable mock scores on Jev's 0–9 scale (server adds 1 → displays as 1–10).
// Typed against the canonical DimensionKey union so a rubric change makes the
// mock a compile error rather than a silent omission.
const MOCK_DIM_SCORES: Record<ProviderID, Record<DimensionKey, number>> = {
  openai:    { reasoning: 4.8, coherence: 5.2, evidence: 4.6, honesty: 5.0 },
  anthropic: { reasoning: 5.8, coherence: 6.1, evidence: 5.5, honesty: 6.2 },
  google:    { reasoning: 4.2, coherence: 4.4, evidence: 4.0, honesty: 4.5 },
}
// MOCK_OVERALL values equal each provider's reasoning score to preserve the
// pre-refactor wire byte-for-byte. The old suffix-parse mock had a subtle
// misordered-condition where `${p}_overall` fell through to the first dim
// iteration (reasoning), so overall == reasoning on the wire. Preserved
// verbatim; snapshots pin this. A future intentional change to mock overall
// values must update goldens deliberately.
const MOCK_OVERALL: Record<ProviderID, number> = {
  openai: 4.8, anthropic: 5.8, google: 4.2,
}
// Mock noul defaults per flag. Values chosen so the pre-refactor snapshots
// match verbatim: eqAnchor=0.7 (burden exists → NOT anchored per policy),
// fabrication=0.1 (no fabrication), contradiction=0.1 (no contradiction).
const MOCK_FLAG_NOUL: Record<FlagKey, number> = {
  eqAnchor:      0.7,
  fabrication:   0.1,
  contradiction: 0.1,
}
// Fallback noul for any noul-type question NOT tied to a canonical FlagKey
// (currently: relevance gate, claim_risk final key, and locateFabrication
// span questions). Preserved from pre-refactor default of 0.2.
const MOCK_NOUL_DEFAULT = 0.2

const PROVIDERS: readonly ProviderID[] = ['openai', 'anthropic', 'google']

// Precompute score/noul lookups from canonical schema iteration. Keys here
// are the ONLY keys the mock recognizes for typed lookup; anything else
// falls back to the neutral default (5.5 score / 0.2 noul).
const MOCK_SCORE_LOOKUP: Record<string, number> = {}
const MOCK_NOUL_LOOKUP: Record<string, number> = {}
for (const p of PROVIDERS) {
  for (const d of DIMENSIONS) {
    MOCK_SCORE_LOOKUP[dimensionKey(p, d.key as DimensionKey)] = MOCK_DIM_SCORES[p][d.key as DimensionKey]
  }
  MOCK_SCORE_LOOKUP[finalKey(p, 'overall')] = MOCK_OVERALL[p]
  for (const f of FLAGS) {
    MOCK_NOUL_LOOKUP[flagKey(p, f.key as FlagKey)] = MOCK_FLAG_NOUL[f.key as FlagKey]
  }
}

function mockResponse(questions: Record<string, JevQuestion>): JevResponse {
  const answers: Record<string, JevAnswer> = {}
  for (const [key, q] of Object.entries(questions)) {
    if (q.type === 'score') {
      answers[key] = { type: 'score', score: MOCK_SCORE_LOOKUP[key] ?? 5.5, confidence: 0.70 }
    } else if (q.type === 'choice') {
      const opts = Object.keys(q.criteria)
      // Derive the winner from the same mock overall scores that populate the
      // scorecard so Verdict can never contradict what the user sees. Falls
      // back to the first non-tie option only if there are no provider opts.
      const providerOpts = opts.filter(o => o !== 'tie') as ProviderID[]
      const scoreOf = (p: ProviderID): number => MOCK_OVERALL[p] ?? 5.5
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
      // noul: canonical flags get their pinned mock value; everything else
      // (relevance gate, claim_risk, locateFabrication spans) gets the default.
      const noul = MOCK_NOUL_LOOKUP[key] ?? MOCK_NOUL_DEFAULT
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
    const message = `Jev API ${res.status}: ${text}`
    const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'))
    const status = res.status
    if (status === 429) {
      throw new AdapterError({ category: 'quota', provider: 'jev', message, retryAfterMs })
    }
    if (status === 401 || status === 403) {
      throw new AdapterError({ category: 'auth', provider: 'jev', message })
    }
    if (status === 502 || status === 503 || status === 529) {
      throw new AdapterError({ category: 'overloaded', provider: 'jev', message })
    }
    if (status === 504) {
      throw new AdapterError({ category: 'timeout', provider: 'jev', message })
    }
    throw new AdapterError({ category: 'unknown', provider: 'jev', message })
  }

  return res.json() as Promise<JevResponse>
}
