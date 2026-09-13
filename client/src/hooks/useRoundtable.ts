import { useState } from 'react'
import type { ModelId, ModelResponse, RoundtableResponses } from '../types'
import { MODEL_CONFIGS } from '../types'

const INITIAL_RESPONSES: RoundtableResponses = {
  openai: { status: 'idle' },
  anthropic: { status: 'idle' },
  google: { status: 'idle' },
}

async function fetchModelResponse(prompt: string, modelId: ModelId): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, modelId }),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(error.message ?? 'Request failed')
  }

  const data = await res.json() as { content: string }
  return data.content
}

export function useRoundtable() {
  const [responses, setResponses] = useState<RoundtableResponses>(INITIAL_RESPONSES)
  const [isLoading, setIsLoading] = useState(false)

  function setModelResponse(modelId: ModelId, response: ModelResponse) {
    setResponses(prev => ({ ...prev, [modelId]: response }))
  }

  async function submitPrompt(prompt: string) {
    if (isLoading) return
    setIsLoading(true)

    // Set all models to loading simultaneously
    const modelIds = Object.keys(MODEL_CONFIGS) as ModelId[]
    for (const id of modelIds) {
      setModelResponse(id, { status: 'loading' })
    }

    // Fire all three requests in parallel — the core of the first-pass round
    await Promise.allSettled(
      modelIds.map(async (modelId) => {
        try {
          const content = await fetchModelResponse(prompt, modelId)
          setModelResponse(modelId, { status: 'complete', content })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          setModelResponse(modelId, { status: 'error', message })
        }
      }),
    )

    setIsLoading(false)
  }

  function reset() {
    setResponses(INITIAL_RESPONSES)
    setIsLoading(false)
  }

  return { responses, isLoading, submitPrompt, reset }
}
