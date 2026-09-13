import type { Request, Response, Router } from 'express'
import express from 'express'
import { askAnthropic } from '../adapters/anthropic'
import { askGoogle } from '../adapters/google'
import { askOpenAI } from '../adapters/openai'

const router: Router = express.Router()

type ModelId = 'openai' | 'anthropic' | 'google'

const MOCK_RESPONSES: Record<ModelId, string> = {
  openai:
    "I don't have access to real-time information, but I can help you think through this. Based on my training data, here's my perspective on your question...",
  anthropic:
    "That's an interesting question. Let me share my analysis, which may differ somewhat from what other models might say...",
  google:
    'Based on the latest information available to me, here are some key points to consider about your question...',
}

const adapters: Record<ModelId, (prompt: string) => Promise<string>> = {
  openai: askOpenAI,
  anthropic: askAnthropic,
  google: askGoogle,
}

const apiKeyPresent: Record<ModelId, boolean> = {
  openai: Boolean(process.env.OPENAI_API_KEY),
  anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  google: Boolean(process.env.GOOGLE_API_KEY),
}

router.post('/', async (req: Request, res: Response) => {
  const { prompt, modelId } = req.body as { prompt?: string; modelId?: string }

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ message: 'prompt is required' })
    return
  }

  if (!modelId || !(modelId in adapters)) {
    res.status(400).json({ message: 'invalid modelId' })
    return
  }

  const id = modelId as ModelId

  // Fall back to mock if API key isn't set yet
  if (!apiKeyPresent[id]) {
    await new Promise(r => setTimeout(r, 800 + Math.random() * 600))
    res.json({ content: `[MOCK — no ${id.toUpperCase()}_API_KEY set] ${MOCK_RESPONSES[id]}` })
    return
  }

  try {
    const content = await adapters[id](prompt)
    res.json({ content })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Adapter error'
    res.status(502).json({ message })
  }
})

export { router as chatRouter }
