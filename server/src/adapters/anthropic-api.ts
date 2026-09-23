import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '../models.js'

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
    if (err instanceof Anthropic.APIError) {
      if (err.status === 429) throw new Error(`QUOTA_EXCEEDED: ${err.message}`)
      if (err.status === 529 || err.status === 503) throw new Error(`CLAUDE_OVERLOADED: ${err.message}`)
    }
    throw err
  }
}
