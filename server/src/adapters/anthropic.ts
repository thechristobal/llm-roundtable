import { query } from '@anthropic-ai/claude-agent-sdk'

export const MODEL = 'claude-sonnet-4-6'
export const KNOWN_WORKING_MODELS: readonly string[] = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
]

export async function askAnthropic(prompt: string, systemPrompt?: string): Promise<string> {
  let text = ''

  const stream = query({
    prompt,
    options: {
      model: MODEL,
      allowedTools: [],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      systemPrompt,
      env: Object.fromEntries(
        Object.entries(process.env).filter(([k]) => k !== 'ANTHROPIC_API_KEY')
      ) as Record<string, string>,
    },
  })

  for await (const message of stream) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') text += block.text
      }
    }
  }

  return text
}
