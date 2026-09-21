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
import { queryJev } from './adapters/jev.js'
import { buildRoundState, buildRoundQuestions, buildFinalState, buildFinalQuestions, type JudgeRound } from './judgePrompt.js'

const ALL_PROVIDERS = ['openai', 'anthropic', 'google']

const app = express()
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

    const dims = ['reasoning', 'rebuttal', 'coherence', 'evidence', 'honesty', 'spirit'] as const
    const providers: Record<string, unknown> = {}

    for (const p of activeProviders) {
      const dimScores = Object.fromEntries(
        dims.map(d => [d, {
          score: jevScore(answers[`${p}_${d}`]?.score),
          confidence: answers[`${p}_${d}`]?.confidence ?? 0,
        }])
      )
      const overall = Math.round(dims.reduce((sum, d) => sum + (dimScores[d] as { score: number }).score, 0) / dims.length * 10) / 10
      providers[p] = { ...dimScores, overall }
    }

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
app.listen(port, () => console.log(`Server running on port ${port}`))
