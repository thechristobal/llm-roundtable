import { Codex } from '@openai/codex-sdk'

export const MODEL = 'gpt-5.6-sol'
// Models confirmed working with this ChatGPT Plus account. Not exhaustive — other Codex-compatible models may exist.
export const KNOWN_WORKING_MODELS: readonly string[] = ['gpt-5.6-sol']

let codex: Codex | null = null
function getClient() {
  if (!codex) codex = new Codex()
  return codex
}

export async function askOpenAI(prompt: string, systemPrompt?: string): Promise<string> {
  const thread = getClient().startThread({ model: MODEL, skipGitRepoCheck: true })
  const fullPrompt = systemPrompt ? `[Context]\n${systemPrompt}\n\n[Question]\n${prompt}` : prompt
  const turn = await thread.run(fullPrompt)
  return turn.finalResponse ?? ''
}
