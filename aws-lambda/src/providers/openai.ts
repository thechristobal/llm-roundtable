import OpenAI from 'openai'
import { classifyOpenAIError } from '../../../server/src/adapters/errors.js'
import { OPENAI_MODEL } from '../../../server/src/models.js'

export interface AskArgs {
  apiKey: string
  prompt: string
  systemPrompt?: string
  maxOutputTokens: number
  signal?: AbortSignal
}

export interface AskResult {
  content: string
  model: string
}

// BYO key varies per request, so no module-level client cache.
export async function askOpenAI({ apiKey, prompt, systemPrompt, maxOutputTokens, signal }: AskArgs): Promise<AskResult> {
  const client = new OpenAI({ apiKey })
  const messages: OpenAI.ChatCompletionMessageParam[] = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: prompt })

  try {
    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      max_completion_tokens: maxOutputTokens,
    }, signal ? { signal } : undefined)
    return {
      content: response.choices[0]?.message?.content ?? '',
      model: response.model ?? OPENAI_MODEL,
    }
  } catch (err) {
    throw classifyOpenAIError(err)
  }
}
