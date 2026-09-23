import { CLAUDE_CLI_ENABLED } from '../features.js'
import { askAnthropicViaApi } from './anthropic-api.js'
import { askAnthropicViaCli } from './anthropic-cli.js'

// Set by electron/main.ts based on detected CLI login state + stored API key presence.
// Values: 'cli' | 'api' | 'none'. Restart-on-Settings-change keeps this fresh.
const BACKEND = process.env.ROUNDTABLE_CLAUDE_BACKEND ?? 'none'

export async function askAnthropic(prompt: string, systemPrompt?: string): Promise<string> {
  if (BACKEND === 'cli' && CLAUDE_CLI_ENABLED) return askAnthropicViaCli(prompt, systemPrompt)
  if (BACKEND === 'api') return askAnthropicViaApi(prompt, systemPrompt)
  throw new Error('Claude is not configured — sign in to Claude Code or add an Anthropic API key in Settings.')
}
