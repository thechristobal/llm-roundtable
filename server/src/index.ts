import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import express from 'express'
import { askAnthropic } from './adapters/anthropic.js'
import { askGoogle } from './adapters/google.js'
import { askOpenAI } from './adapters/openai.js'
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
    } else {
      res.status(500).json({ error: message || 'Unknown error' })
    }
  }
})

const port = process.env.PORT ?? 3001
app.listen(port, () => console.log(`Server running on port ${port}`))
