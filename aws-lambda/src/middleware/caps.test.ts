import { describe, expect, it } from 'vitest'
import { CapsViolation, extractSourceIp, validateDebateRequest } from './caps.js'

describe('validateDebateRequest', () => {
  it('accepts a well-formed opening', () => {
    const body = { action: 'opening', prompt: 'hi', rounds: [] }
    expect(validateDebateRequest(body)).toEqual(body)
  })

  it('rejects prompts over the cap', () => {
    expect(() => validateDebateRequest({
      action: 'opening',
      prompt: 'a'.repeat(2000),
      rounds: [],
    })).toThrow(CapsViolation)
  })

  it('rejects too many subsequent actions', () => {
    expect(() => validateDebateRequest({
      action: 'fight',
      prompt: 'go',
      rounds: [
        { trigger: 'initial', prompt: 'q', responses: {} },
        { trigger: 'fight', prompt: null, responses: {} },
        { trigger: 'fight', prompt: null, responses: {} },
        { trigger: 'fight', prompt: null, responses: {} },
      ],
    })).toThrow(CapsViolation)
  })

  it('rejects unknown action', () => {
    expect(() => validateDebateRequest({
      action: 'summon_jury',
      prompt: 'go',
      rounds: [],
    })).toThrow(CapsViolation)
  })
})

describe('extractSourceIp', () => {
  it('prefers CloudFront-Viewer-Address and strips port', () => {
    expect(extractSourceIp({ 'cloudfront-viewer-address': '203.0.113.5:54321' })).toBe('203.0.113.5')
  })

  it('falls back to X-Forwarded-For first hop', () => {
    expect(extractSourceIp({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' })).toBe('203.0.113.5')
  })

  it('returns "unknown" when neither header present', () => {
    expect(extractSourceIp({})).toBe('unknown')
  })
})
