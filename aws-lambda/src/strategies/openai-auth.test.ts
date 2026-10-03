import { afterEach, describe, expect, it } from 'vitest'
import { ByoApiKeyStrategy, ChatGptOauthStrategy, selectOpenAiAuthStrategy } from './openai-auth.js'

describe('ByoApiKeyStrategy', () => {
  it('reads X-Openai-Key header (lowercase, API GW normalizes)', () => {
    expect(ByoApiKeyStrategy.extractCredential({ 'x-openai-key': 'sk-abc' })).toBe('sk-abc')
  })

  it('trims whitespace', () => {
    expect(ByoApiKeyStrategy.extractCredential({ 'x-openai-key': '  sk-abc  ' })).toBe('sk-abc')
  })

  it('returns undefined when header is missing or empty', () => {
    expect(ByoApiKeyStrategy.extractCredential({})).toBeUndefined()
    expect(ByoApiKeyStrategy.extractCredential({ 'x-openai-key': '   ' })).toBeUndefined()
  })
})

describe('selectOpenAiAuthStrategy', () => {
  const original = process.env.OPENAI_AUTH_MODE
  afterEach(() => {
    if (original === undefined) delete process.env.OPENAI_AUTH_MODE
    else process.env.OPENAI_AUTH_MODE = original
  })

  it('defaults to BYO', () => {
    delete process.env.OPENAI_AUTH_MODE
    expect(selectOpenAiAuthStrategy()).toBe(ByoApiKeyStrategy)
  })

  it('honors OPENAI_AUTH_MODE=chatgpt-oauth', () => {
    process.env.OPENAI_AUTH_MODE = 'chatgpt-oauth'
    expect(selectOpenAiAuthStrategy()).toBe(ChatGptOauthStrategy)
  })
})
