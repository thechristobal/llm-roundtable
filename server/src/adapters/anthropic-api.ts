import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '../models.js'
import { classifyAnthropicError } from './errors.js'

let client: Anthropic | null = null
function getClient() {
  if (!client) client = new Anthropic()
  return client
}

export async function askAnthropicViaApi(prompt: string, systemPrompt?: string): Promise<string> {
  try {
    const response = await getClient().messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 8192,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: 'user', content: prompt }],
    })

    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('')
  } catch (err) {
    throw classifyAnthropicError(err)
  }
}
