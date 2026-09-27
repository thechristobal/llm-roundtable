import dotenv from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
// package is ESM ("type":"module"), so __dirname isn't defined — derive it.
const __dirname = dirname(fileURLToPath(import.meta.url))
// Works from server/src/ (dev) and from electron/resources/ (bundled)
dotenv.config({ path: resolve(__dirname, '../.env.local') })
dotenv.config({ path: resolve(__dirname, '../../server/.env.local') })
import express from 'express'
import { askAnthropic } from './adapters/anthropic.js'
import { askGoogle } from './adapters/google.js'
import { askOpenAI } from './adapters/openai.js'
import { ANTHROPIC_MODEL, GOOGLE_MODEL, OPENAI_MODEL } from './models.js'

const PROVIDER_MODELS: Record<string, string> = {
  openai: OPENAI_MODEL,
  anthropic: ANTHROPIC_MODEL,
  google: GOOGLE_MODEL,
}
import { buildDebateSystemPrompt, type DebateAction, type DebateRound, type JevFinalContext, type JevRoundContext } from './debatePrompt.js'
import { buildSystemPrompt } from './systemPrompt.js'
import { queryJev, type JevQuestion } from './adapters/jev.js'
import {
  buildRoundState, buildRoundQuestions,
  buildFinalState, buildFinalQuestions,
  MODEL_NAMES as JEV_MODEL_NAMES,
  type JudgeRound,
} from './jev-questions.js'
import { computeProviderScorecard, type ProviderScorecard } from './jev-policy.js'
import { finalKey } from '../../shared/jev-rubric.js'
import type { ProviderID } from '../../shared/providers.js'
import { AdapterError, toHttpStatus, toWire } from './adapters/errors.js'
import type { AdapterProvider, ApiErrorResponse } from '../../shared/adapter-errors.js'

function sendAdapterError(res: express.Response, err: unknown, provider: AdapterProvider): void {
  if (err instanceof AdapterError) {
    const body: ApiErrorResponse = { error: toWire(err) }
    res.status(toHttpStatus(err.category)).json(body)
    return
  }
  const message = err instanceof Error ? err.message : String(err)
  const body: ApiErrorResponse = {
    error: {
      category: 'unknown',
      provider,
      message: message || 'Unknown error',
      retryable: false,
    },
  }
  res.status(500).json(body)
}

const ALL_PROVIDERS: readonly ProviderID[] = ['openai', 'anthropic', 'google']

function splitSentences(text: string): string[] {
  return text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 25)
}

async function locateFabrication(responseText: string, providerName: string): Promise<string[]> {
  const sentences = splitSentences(responseText)
  if (sentences.length === 0) return []
  const questions: Record<string, JevQuestion> = Object.fromEntries(
    sentences.map((s, i) => [`span_${i}`, {
      type: 'noul' as const,
      instructions: `Does this span contain the fabricated or materially misrepresented claim identified in ${providerName}'s response?\n\nSpan: "${s}"`,
      criteria: {
        true: 'Yes — this span contains or is part of the fabricated/misrepresented claim',
        false: 'No — this span does not contain fabricated material',
      },
    }])
  )
  const { answers } = await queryJev({ state: { full_response: responseText, provider: providerName }, model: 'jev-latest', questions })
  return sentences.filter((_, i) => (answers[`span_${i}`]?.noul ?? 0) >= 0.6)
}

export const app = express()

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.sendStatus(200); return }
  next()
})

app.use(express.json())

app.post('/api/ask', async (req, res) => {
  const { provider, prompt } = req.body as { provider: string; prompt: string }

  if (!provider || !prompt) {
    res.status(400).json({ error: 'provider and prompt are required' })
    return
  }

  try {
    let content: string
    const systemPrompt = buildSystemPrompt(provider, [...ALL_PROVIDERS])

    if (provider === 'openai') {
      content = await askOpenAI(prompt, systemPrompt)
    } else if (provider === 'anthropic') {
      content = await askAnthropic(prompt, systemPrompt)
    } else if (provider === 'google') {
      content = await askGoogle(prompt, systemPrompt)
    } else {
      res.status(400).json({ error: `Unknown provider: ${provider}` })
      return
    }

    res.json({ content, model: PROVIDER_MODELS[provider] })
  } catch (err) {
    console.error(`[${provider}] Error:`, err)
    sendAdapterError(res, err, provider as AdapterProvider)
  }
})

app.post('/api/debate/ask', async (req, res) => {
  const { provider, action, rounds, followUpPrompt, jevFinal, jevRounds } = req.body as {
    provider: string
    action: DebateAction
    rounds: DebateRound[]
    followUpPrompt?: string
    jevFinal?: JevFinalContext
    jevRounds?: (JevRoundContext | null)[]
  }

  if (!provider || !action || !rounds?.length) {
    res.status(400).json({ error: 'provider, action, and rounds are required' })
    return
  }

  try {
    const systemPrompt = buildDebateSystemPrompt(provider, [...ALL_PROVIDERS], action, rounds, followUpPrompt, jevFinal, jevRounds)
    let content: string

    if (provider === 'openai') {
      content = await askOpenAI('Continue the debate.', systemPrompt)
    } else if (provider === 'anthropic') {
      content = await askAnthropic('Continue the debate.', systemPrompt)
    } else if (provider === 'google') {
      content = await askGoogle('Continue the debate.', systemPrompt)
    } else {
      res.status(400).json({ error: `Unknown provider: ${provider}` })
      return
    }

    res.json({ content, model: PROVIDER_MODELS[provider] })
  } catch (err) {
    console.error(`[debate/${provider}] Error:`, err)
    sendAdapterError(res, err, provider as AdapterProvider)
  }
})

// Wire shim: canonical ProviderScorecard → the exact JSON shape the client
// has always received. Snapshots in routes-goldens.test.ts.snap pin this.
// suspectedFabrication is filled in AFTER by the route (async I/O concern
// kept out of the pure policy layer).
function scorecardToWireProvider(sc: ProviderScorecard) {
  return {
    reasoning: sc.dims.reasoning,
    coherence: sc.dims.coherence,
    evidence:  sc.dims.evidence,
    honesty:   sc.dims.honesty,
    relevance: { noul: sc.gates.relevance.noul, confidence: sc.gates.relevance.confidence },
    overall:   sc.overall,
    eqAnchored:            sc.flags.eqAnchor,
    fabricationDetected:   sc.flags.fabrication,
    contradictionDetected: sc.flags.contradiction,
    // Task Adherence is a gate, not a weighted dimension: if the response
    // failed to engage with the prompt, it's DQ'd for the round regardless
    // of how well-argued the off-topic content was. Whole-debate winner
    // ignores this — recovery across later rounds is Jev's call in /final.
    disqualified: sc.gates.relevance.triggered,
    suspectedFabrication: [] as string[],
  }
}

app.post('/api/judge/round', async (req, res) => {
  const { round, allProviders, isInitial } = req.body as {
    round: JudgeRound
    allProviders: ProviderID[]
    isInitial: boolean
  }

  if (!round || !allProviders?.length) {
    res.status(400).json({ error: 'round and allProviders are required' })
    return
  }

  try {
    const activeProviders = allProviders.filter(p => round.responses[p])
    const state = buildRoundState(round, allProviders)
    const questions = buildRoundQuestions(activeProviders, isInitial)
    const { answers, mock } = await queryJev({ state, model: 'jev-latest', questions })

    const providers: Record<string, ReturnType<typeof scorecardToWireProvider>> = {}
    for (const p of activeProviders) {
      providers[p] = scorecardToWireProvider(computeProviderScorecard(answers, p))
    }

    // Localize fabrication spans for flagged providers (non-blocking)
    await Promise.all(
      activeProviders
        .filter(p => providers[p].fabricationDetected)
        .map(async p => {
          const responseText = round.responses[p] ?? ''
          const spans = await locateFabrication(responseText, JEV_MODEL_NAMES[p] ?? p).catch(() => [])
          providers[p].suspectedFabrication = spans
        })
    )

    res.json({ providers, mock: mock ?? false })
  } catch (err) {
    console.error('[judge/round] Error:', err)
    sendAdapterError(res, err, 'jev')
  }
})

// Converts Jev's 0-9 weighted score to a 1-10 float with one decimal.
// Behavior-identical to the transform inside jev-policy.ts's resolveDimScores.
function jevScore(raw: number | undefined): number {
  return Math.round(((raw ?? 0) + 1) * 10) / 10
}

app.post('/api/judge/final', async (req, res) => {
  const { rounds, allProviders } = req.body as { rounds: JudgeRound[]; allProviders: ProviderID[] }

  if (!rounds?.length || !allProviders?.length) {
    res.status(400).json({ error: 'rounds and allProviders are required' })
    return
  }

  try {
    const activeProviders = allProviders.filter(p =>
      rounds.some(r => r.responses[p])
    )
    const state = buildFinalState(rounds, allProviders)
    const questions = buildFinalQuestions(activeProviders)
    const { answers, mock } = await queryJev({ state, model: 'jev-latest', questions })

    const scores: Record<string, number> = {}
    const claimRisk: Record<string, number> = {}
    for (const p of activeProviders) {
      scores[p] = jevScore(answers[finalKey(p, 'overall')]?.score)
      claimRisk[p] = answers[finalKey(p, 'claim_risk')]?.noul ?? 0
    }

    const winnerAnswer = answers.winner
    const winner = winnerAnswer?.choice ?? 'tie'
    const winnerConfidence = winnerAnswer?.confidence ?? 0

    res.json({ scores, claimRisk, winner, winnerConfidence, mock: mock ?? false })
  } catch (err) {
    console.error('[judge/final] Error:', err)
    sendAdapterError(res, err, 'jev')
  }
})

if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT ?? 3001
  const host = process.env.HOST ?? '0.0.0.0'
  const httpServer = app.listen(Number(port), host, () => console.log(`Server running on ${host}:${port}`))
  httpServer.on('error', err => console.error('[server] listen error', err))
}
