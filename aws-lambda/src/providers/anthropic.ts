import Anthropic from '@anthropic-ai/sdk'
import { classifyAnthropicError } from '../../../server/src/adapters/errors.js'
import { ANTHROPIC_MODEL } from '../../../server/src/models.js'

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

export async function askAnthropic({ apiKey, prompt, systemPrompt, maxOutputTokens, signal }: AskArgs): Promise<AskResult> {
  const client = new Anthropic({ apiKey })
  try {
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: maxOutputTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: 'user', content: prompt }],
    }, signal ? { signal } : undefined)

    const content = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('')
    return { content, model: response.model ?? ANTHROPIC_MODEL }
  } catch (err) {
    throw classifyAnthropicError(err)
  }
}
