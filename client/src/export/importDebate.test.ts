import { describe, it, expect } from 'vitest'
import { parseRoundtableHtml } from './importDebate'

// The exported HTML embeds the debate JSON as:
//   <script type="application/json" id="roundtable-data">...</script>
function wrap(json: unknown): string {
  return `<html><body><script type="application/json" id="roundtable-data">${JSON.stringify(json)}</script></body></html>`
}

describe('parseRoundtableHtml — legacy panel error compat (import boundary only)', () => {
  it('normalizes legacy { status: "error", message: "Quota exhausted ..." } → category=quota AdapterErrorWire', () => {
    const legacy = [{
      trigger: 'initial',
      prompt: 'hi',
      panels: {
        openai: { status: 'error', message: 'Quota exhausted — free tier limit reached.' },
        anthropic: { status: 'complete', content: 'ok', durationMs: 100 },
        google: { status: 'error', message: 'Gemini is experiencing high demand.' },
      },
    }]
    const [round] = parseRoundtableHtml(wrap(legacy))
    const openaiPanel = round.panels.openai
    const googlePanel = round.panels.google
    if (openaiPanel.status !== 'error' || googlePanel.status !== 'error') throw new Error('expected error panels')

    expect(openaiPanel.error).toEqual({
      category: 'quota',
      provider: 'openai',
      message: 'Quota exhausted — free tier limit reached.',
      retryable: false,
    })
    expect(googlePanel.error).toEqual({
      category: 'overloaded',
      provider: 'google',
      message: 'Gemini is experiencing high demand.',
      retryable: true,
    })
  })

  it('normalizes an unrecognized legacy message → category=unknown, retryable=false', () => {
    const legacy = [{
      trigger: 'initial',
      prompt: 'hi',
      panels: {
        openai: { status: 'error', message: 'Something exploded' },
        anthropic: { status: 'idle' },
        google: { status: 'idle' },
      },
    }]
    const [round] = parseRoundtableHtml(wrap(legacy))
    const p = round.panels.openai
    if (p.status !== 'error') throw new Error('expected error panel')
    expect(p.error).toEqual({
      category: 'unknown',
      provider: 'openai',
      message: 'Something exploded',
      retryable: false,
    })
  })

  it('passes current-shape { status: "error", error: AdapterErrorWire } through unchanged', () => {
    const current = [{
      trigger: 'initial',
      prompt: 'hi',
      panels: {
        openai: {
          status: 'error',
          error: { category: 'auth', provider: 'openai', message: 'bad key', retryable: false },
        },
        anthropic: { status: 'idle' },
        google: { status: 'idle' },
      },
    }]
    const [round] = parseRoundtableHtml(wrap(current))
    const p = round.panels.openai
    if (p.status !== 'error') throw new Error('expected error panel')
    expect(p.error).toEqual({
      category: 'auth',
      provider: 'openai',
      message: 'bad key',
      retryable: false,
    })
  })
})

describe('parseRoundtableHtml — structural rejects', () => {
  it('throws when no roundtable-data script is present', () => {
    expect(() => parseRoundtableHtml('<html><body>nothing here</body></html>')).toThrow(/No Roundtable data/)
  })

  it('throws when the embedded JSON is corrupt', () => {
    const html = '<html><body><script type="application/json" id="roundtable-data">{not json</script></body></html>'
    expect(() => parseRoundtableHtml(html)).toThrow(/corrupted/)
  })

  it('throws when the parsed payload is not an array of rounds', () => {
    expect(() => parseRoundtableHtml(wrap({ notAnArray: true }))).toThrow(/unexpected shape/)
  })
})
