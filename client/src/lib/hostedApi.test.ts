// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fetchDebateStream, type StreamEvent, HostedApiError } from './hostedApi'

function mockFetchStreamingBody(chunks: string[], status = 200): typeof fetch {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(enc.encode(chunk))
      controller.close()
    },
  })
  const res = new Response(stream, { status, headers: { 'content-type': 'application/x-ndjson' } })
  return vi.fn().mockResolvedValue(res) as unknown as typeof fetch
}

describe('fetchDebateStream NDJSON parsing', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    sessionStorage.setItem('roundtable_bearer', 'test-bearer')
  })

  afterEach(() => {
    sessionStorage.clear()
    globalThis.fetch = originalFetch
  })

  it('parses line-by-line and forwards every event', async () => {
    globalThis.fetch = mockFetchStreamingBody([
      '{"type":"start","ts":1}\n',
      '{"type":"provider_complete","provider":"openai","ok":true,"content":"hi","model":"gpt-5"}\n',
      '{"type":"done","ts":2}\n',
    ])
    const events: StreamEvent[] = []
    await fetchDebateStream({ action: 'opening', prompt: 'test', rounds: [] }, e => events.push(e))
    expect(events).toHaveLength(3)
    expect(events[0]).toEqual({ type: 'start', ts: 1 })
    expect(events[1]).toMatchObject({ type: 'provider_complete', provider: 'openai', ok: true, content: 'hi' })
    expect(events[2]).toEqual({ type: 'done', ts: 2 })
  })

  it('handles multiple events in one chunk', async () => {
    globalThis.fetch = mockFetchStreamingBody([
      '{"type":"start","ts":1}\n{"type":"heartbeat","ts":2}\n{"type":"done","ts":3}\n',
    ])
    const events: StreamEvent[] = []
    await fetchDebateStream({ action: 'opening', prompt: 'test', rounds: [] }, e => events.push(e))
    expect(events).toHaveLength(3)
  })

  it('handles an event split across chunks', async () => {
    globalThis.fetch = mockFetchStreamingBody([
      '{"type":"provider_',
      'complete","provider":"anthropic","ok":true,"content":"ok","model":"claude"}\n',
    ])
    const events: StreamEvent[] = []
    await fetchDebateStream({ action: 'opening', prompt: 'test', rounds: [] }, e => events.push(e))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ provider: 'anthropic', ok: true })
  })

  it('skips malformed lines without aborting', async () => {
    globalThis.fetch = mockFetchStreamingBody([
      '{"type":"start","ts":1}\nnot-json\n{"type":"done","ts":2}\n',
    ])
    const events: StreamEvent[] = []
    await fetchDebateStream({ action: 'opening', prompt: 'test', rounds: [] }, e => events.push(e))
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: 'start' })
    expect(events[1]).toMatchObject({ type: 'done' })
  })

  it('throws HostedApiError on 401 so caller can clear the stale bearer', async () => {
    globalThis.fetch = mockFetchStreamingBody([], 401)
    await expect(
      fetchDebateStream({ action: 'opening', prompt: 'test', rounds: [] }, () => {}),
    ).rejects.toBeInstanceOf(HostedApiError)
  })

  it('throws when no bearer is present', async () => {
    sessionStorage.clear()
    await expect(
      fetchDebateStream({ action: 'opening', prompt: 'test', rounds: [] }, () => {}),
    ).rejects.toBeInstanceOf(HostedApiError)
  })
})
