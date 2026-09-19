import { Codex } from '@openai/codex-sdk'

let codex: Codex | null = null
function getClient() {
  if (!codex) codex = new Codex()
  return codex
}

export async function askOpenAI(prompt: string, systemPrompt?: string): Promise<string> {
  const thread = getClient().startThread({ skipGitRepoCheck: true })
  const fullPrompt = systemPrompt ? `[Context]\n${systemPrompt}\n\n[Question]\n${prompt}` : prompt
  const turn = await thread.run(fullPrompt)
  return turn.finalResponse ?? ''
}
