import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdapterError } from '../../../server/src/adapters/errors.js'
import { DEMO_CAPS } from '../config/demo.js'
import type { StreamEvent } from '../types.js'

vi.mock('../providers/openai.js', () => ({
  askOpenAI: vi.fn(),
}))
vi.mock('../providers/anthropic.js', () => ({
  askAnthropic: vi.fn(),
}))
vi.mock('../providers/google.js', () => ({
  askGoogle: vi.fn(),
}))

const { askOpenAI } = await import('../providers/openai.js')
const { askAnthropic } = await import('../providers/anthropic.js')
const { askGoogle } = await import('../providers/google.js')
const { orchestrate } = await import('./debate.js')

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const evt of gen) out.push(evt)
  return out
}

describe('orchestrate', () => {
  beforeEach(() => {
    vi.mocked(askOpenAI).mockReset().mockResolvedValue({ content: 'o', model: 'gpt-x' })
    vi.mocked(askAnthropic).mockReset().mockResolvedValue({ content: 'a', model: 'claude-x' })
    vi.mocked(askGoogle).mockReset().mockResolvedValue({ content: 'g', model: 'gemini-x' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits start, one provider_complete per provider, then done', async () => {
    const events = await collect(orchestrate({
      action: 'opening',
      prompt: 'hi',
      rounds: [],
      credentials: { openai: 'k1', anthropic: 'k2', google: 'k3' },
    }))
    const kinds = events.map(e => e.type)
    expect(kinds[0]).toBe('start')
    expect(kinds[kinds.length - 1]).toBe('done')
    const completes = events.filter(e => e.type === 'provider_complete')
    expect(completes).toHaveLength(3)
    const providers = completes.map(e => (e as { provider: string }).provider).sort()
    expect(providers).toEqual(['anthropic', 'google', 'openai'])
  })

  it('emits an auth error without calling the provider when key is missing', async () => {
    const events = await collect(orchestrate({
      action: 'opening',
      prompt: 'hi',
      rounds: [],
      credentials: { anthropic: 'k2', google: 'k3' },
    }))
    expect(vi.mocked(askOpenAI)).not.toHaveBeenCalled()
    const openai = events.find(e => e.type === 'provider_complete' && e.provider === 'openai')
    expect(openai).toMatchObject({ ok: false, error: { category: 'auth', retryable: false } })
  })

  it('maps AdapterError onto the provider_complete error payload', async () => {
    vi.mocked(askAnthropic).mockRejectedValue(new AdapterError({
      category: 'overloaded',
      provider: 'anthropic',
      message: '529 overloaded',
    }))
    const events = await collect(orchestrate({
      action: 'opening',
      prompt: 'hi',
      rounds: [],
      credentials: { openai: 'k1', anthropic: 'k2', google: 'k3' },
    }))
    const anthropic = events.find(e => e.type === 'provider_complete' && e.provider === 'anthropic')
    expect(anthropic).toMatchObject({ ok: false, error: { category: 'overloaded', retryable: true } })
  })

  it('truncates provider content to the response byte cap', async () => {
    const oversized = 'x'.repeat(DEMO_CAPS.perProviderResponseByteCap + 1024)
    vi.mocked(askOpenAI).mockResolvedValue({ content: oversized, model: 'gpt-x' })
    const events = await collect(orchestrate({
      action: 'opening',
      prompt: 'hi',
      rounds: [],
      credentials: { openai: 'k1', anthropic: 'k2', google: 'k3' },
    }))
    const openai = events.find(e => e.type === 'provider_complete' && e.provider === 'openai')
    expect(openai).toMatchObject({ ok: true })
    const content = (openai as { content: string }).content
    expect(Buffer.byteLength(content, 'utf8')).toBeLessThanOrEqual(DEMO_CAPS.perProviderResponseByteCap)
  })
})
