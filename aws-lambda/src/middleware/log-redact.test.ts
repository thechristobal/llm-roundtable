import { describe, expect, it, vi } from 'vitest'
import { logInfo, redact, redactHeaders } from './log-redact.js'

describe('redact', () => {
  it('scrubs OpenAI sk-proj keys', () => {
    expect(redact('key=sk-proj-abc123def456ghi789jkl012mno')).toBe('key=[REDACTED]')
  })

  it('scrubs Anthropic sk-ant keys', () => {
    expect(redact('header: sk-ant-api03-REAL_KEY_SHAPE_abc123def456')).toBe('header: [REDACTED]')
  })

  it('scrubs Google AIza keys', () => {
    expect(redact('AIzaSyA12345678901234567890123456789012')).toBe('[REDACTED]')
  })

  it('scrubs JWT shapes', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJqdGk6YWJjIn0.sigpart_abcdef1234567890'
    expect(redact(`token=${jwt}`)).toBe('token=[REDACTED]')
  })

  it('scrubs Bearer tokens', () => {
    expect(redact('Authorization: Bearer abcdefghijklmnop')).toBe('Authorization: [REDACTED]')
  })

  it('leaves non-credential text alone', () => {
    expect(redact('user=alice route=/api/debate dur=1234ms')).toBe('user=alice route=/api/debate dur=1234ms')
  })
})

describe('redactHeaders', () => {
  it('replaces credential header values with [REDACTED]', () => {
    const out = redactHeaders({
      'x-openai-key': 'sk-proj-realkeyvalue',
      'content-type': 'application/json',
      'authorization': 'Bearer eyJ...',
    })
    expect(out['x-openai-key']).toBe('[REDACTED]')
    expect(out['authorization']).toBe('[REDACTED]')
    expect(out['content-type']).toBe('application/json')
  })
})

describe('logInfo', () => {
  it('scrubs any credential-shaped substring in log fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logInfo({ event: 'test', note: 'got key sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
    const call = spy.mock.calls[0]?.[0] as string
    expect(call).not.toContain('sk-proj-AAAA')
    expect(call).toContain('[REDACTED]')
    spy.mockRestore()
  })
})
