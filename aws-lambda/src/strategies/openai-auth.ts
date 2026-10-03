// OpenAI auth strategy. Today we only accept BYO API keys supplied per request
// via the X-Openai-Key header. The strategy indirection is here so that a
// future "Sign in with ChatGPT" OAuth path can slot in without touching callers.

export interface OpenAiAuthStrategy {
  readonly mode: 'byo-api-key' | 'chatgpt-oauth'
  extractCredential(headers: Record<string, string | undefined>): string | undefined
}

const BYO_HEADER = 'x-openai-key'

export const ByoApiKeyStrategy: OpenAiAuthStrategy = {
  mode: 'byo-api-key',
  extractCredential(headers) {
    const value = headers[BYO_HEADER]
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  },
}

// Placeholder. Sign in with ChatGPT requires Anthropic-style app review before
// OpenAI will approve the client; see https://platform.openai.com/docs/.
// Implementing this means (a) short-lived access tokens exchanged for an API
// key per session and (b) server-held client secret in SSM.
export const ChatGptOauthStrategy: OpenAiAuthStrategy = {
  mode: 'chatgpt-oauth',
  extractCredential() {
    throw new Error('ChatGptOauthStrategy not implemented — pending OpenAI app review')
  },
}

export function selectOpenAiAuthStrategy(): OpenAiAuthStrategy {
  const mode = process.env.OPENAI_AUTH_MODE
  if (mode === 'chatgpt-oauth') return ChatGptOauthStrategy
  return ByoApiKeyStrategy
}
