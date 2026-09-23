import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import express from 'express'
import { askAnthropic, MODEL as ANTHROPIC_MODEL } from './adapters/anthropic.js'
import { askGoogle, MODEL as GOOGLE_MODEL } from './adapters/google.js'
import { askOpenAI, MODEL as OPENAI_MODEL } from './adapters/openai.js'

const PROVIDER_MODELS: Record<string, string> = {
  openai: OPENAI_MODEL,
  anthropic: ANTHROPIC_MODEL,
  google: GOOGLE_MODEL,
}
import { buildDebateSystemPrompt, type DebateAction, type DebateRound, type JevFinalContext, type JevRoundContext } from './debatePrompt.js'
import { buildSystemPrompt } from './systemPrompt.js'
import { queryJev, type JevQuestion } from './adapters/jev.js'
import { buildRoundState, buildRoundQuestions, buildFinalState, buildFinalQuestions, type JudgeRound } from './judgePrompt.js'

const ALL_PROVIDERS = ['openai', 'anthropic', 'google']

const MODEL_NAMES: Record<string, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
}

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

const app = express()

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
    const systemPrompt = buildSystemPrompt(provider, ALL_PROVIDERS)

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
    const message = err instanceof Error ? err.message : String(err)
    if (message.startsWith('QUOTA_EXCEEDED:')) {
      res.status(429).json({ error: 'Quota exhausted — free tier limit reached. Try again tomorrow or upgrade your API key.' })
    } else if (message.startsWith('GEMINI_OVERLOADED:')) {
      res.status(503).json({ error: 'Gemini is experiencing high demand. Try again in a moment.' })
    } else {
      res.status(500).json({ error: message || 'Unknown error' })
    }
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
    const systemPrompt = buildDebateSystemPrompt(provider, ALL_PROVIDERS, action, rounds, followUpPrompt, jevFinal, jevRounds)
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
    const message = err instanceof Error ? err.message : String(err)
    if (message.startsWith('QUOTA_EXCEEDED:')) {
      res.status(429).json({ error: 'Quota exhausted — free tier limit reached. Try again tomorrow or upgrade your API key.' })
    } else if (message.startsWith('GEMINI_OVERLOADED:')) {
      res.status(503).json({ error: 'Gemini is experiencing high demand. Try again in a moment.' })
    } else {
      res.status(500).json({ error: message || 'Unknown error' })
    }
  }
})

// Converts Jev's 0-9 weighted score to a 1-10 float with one decimal
function jevScore(raw: number | undefined): number {
  return Math.round(((raw ?? 0) + 1) * 10) / 10
}


app.post('/api/judge/round', async (req, res) => {
  const { round, allProviders, isInitial } = req.body as {
    round: JudgeRound
    allProviders: string[]
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

    const dims = ['reasoning', 'coherence', 'evidence', 'honesty'] as const
    const WEIGHTS = { reasoning: 0.40, honesty: 0.33, evidence: 0.05, coherence: 0.22 } as const
    const providers: Record<string, unknown> = {}

    for (const p of activeProviders) {
      const dimScores: Record<string, { score: number; confidence: number }> = Object.fromEntries(
        dims.map(d => [d, {
          score: jevScore(answers[`${p}_${d}`]?.score),
          confidence: answers[`${p}_${d}`]?.confidence ?? 0,
        }])
      )

      const eqAnchored = (answers[`${p}_eq_burden`]?.noul ?? 0) < 0.5
      const contradictionDetected = (answers[`${p}_contradiction`]?.noul ?? 0) >= 0.5
      const fabricationDetected = (answers[`${p}_fabrication`]?.noul ?? 0) >= 0.5

      if (eqAnchored) dimScores.evidence = { ...dimScores.evidence, score: 5.0 }
      if (contradictionDetected) {
        dimScores.coherence = { ...dimScores.coherence, score: Math.min(dimScores.coherence.score, 1.0) }
      }
      if (fabricationDetected) {
        dimScores.evidence = { ...dimScores.evidence, score: Math.min(dimScores.evidence.score, 1.0) }
        dimScores.honesty = { ...dimScores.honesty, score: Math.min(dimScores.honesty.score, 3.0) }
      }

      const overall = Math.round(
        (dimScores.reasoning.score * WEIGHTS.reasoning +
         dimScores.honesty.score * WEIGHTS.honesty +
         dimScores.evidence.score * WEIGHTS.evidence +
         dimScores.coherence.score * WEIGHTS.coherence) * 10
      ) / 10

      const relevance = {
        noul: answers[`${p}_relevance`]?.noul ?? 0,
        confidence: answers[`${p}_relevance`]?.confidence ?? 0,
      }
      providers[p] = { ...dimScores, relevance, overall, eqAnchored, fabricationDetected, contradictionDetected, suspectedFabrication: [] as string[] }
    }

    // Localize fabrication spans for flagged providers (non-blocking)
    await Promise.all(
      activeProviders
        .filter(p => (providers[p] as { fabricationDetected: boolean }).fabricationDetected)
        .map(async p => {
          const responseText = round.responses[p] ?? ''
          const spans = await locateFabrication(responseText, MODEL_NAMES[p] ?? p).catch(() => [])
          ;(providers[p] as { suspectedFabrication: string[] }).suspectedFabrication = spans
        })
    )

    res.json({ providers, mock: mock ?? false })
  } catch (err) {
    console.error('[judge/round] Error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Evaluation failed' })
  }
})

app.post('/api/judge/final', async (req, res) => {
  const { rounds, allProviders } = req.body as { rounds: JudgeRound[]; allProviders: string[] }

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
      scores[p] = jevScore(answers[`${p}_overall`]?.score)
      claimRisk[p] = answers[`${p}_claim_risk`]?.noul ?? 0
    }

    const winnerAnswer = answers.winner
    const winner = winnerAnswer?.choice ?? 'tie'
    const winnerConfidence = winnerAnswer?.confidence ?? 0

    res.json({ scores, claimRisk, winner, winnerConfidence, mock: mock ?? false })
  } catch (err) {
    console.error('[judge/final] Error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Judgment failed' })
  }
})

const port = process.env.PORT ?? 3001
const host = process.env.HOST ?? '0.0.0.0'
app.listen(Number(port), host, () => console.log(`Server running on ${host}:${port}`))
