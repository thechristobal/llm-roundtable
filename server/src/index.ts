import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import express from 'express'
import { askAnthropic } from './adapters/anthropic.js'
import { askGoogle } from './adapters/google.js'
import { askOpenAI } from './adapters/openai.js'
import { buildDebateSystemPrompt, type DebateAction, type DebateRound } from './debatePrompt.js'
import { buildSystemPrompt } from './systemPrompt.js'

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

    res.json({ content })
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
  const { provider, action, rounds, followUpPrompt } = req.body as { provider: string; action: DebateAction; rounds: DebateRound[]; followUpPrompt?: string }

  if (!provider || !action || !rounds?.length) {
    res.status(400).json({ error: 'provider, action, and rounds are required' })
    return
  }

  try {
    const systemPrompt = buildDebateSystemPrompt(provider, ALL_PROVIDERS, action, rounds, followUpPrompt)
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

    res.json({ content })
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

const port = process.env.PORT ?? 3001
app.listen(port, () => console.log(`Server running on port ${port}`))
