import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AdapterError as AdapterErrorType } from './errors.js'

// Hoisted mock for the Anthropic SDK — the vi.mock factory runs before any import.
const createMock = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  class MockAPIError extends Error {
    status?: number
    headers?: Record<string, string>
    constructor(status: number, message: string, headers?: Record<string, string>) {
      super(message)
      this.status = status
      this.headers = headers
    }
  }
  class Anthropic {
    messages = { create: createMock }
  }
  ;(Anthropic as unknown as { APIError: typeof MockAPIError }).APIError = MockAPIError
  return { default: Anthropic }
})

let askAnthropicViaApi: (prompt: string, systemPrompt?: string) => Promise<string>
let AdapterError: typeof AdapterErrorType
let AnthropicMod: { APIError: new (status: number, message: string, headers?: Record<string, string>) => Error & { status: number; headers?: Record<string, string> } }

// vi.resetModules() re-imports errors.js, minting a fresh AdapterError class
// on every test. If we imported AdapterError at the top of the file it would
// be the *pre-reset* class and instanceof checks against the *post-reset*
// class (the one the adapter throws) would fail. Re-import in beforeEach.
beforeEach(async () => {
  vi.resetModules()
  createMock.mockReset()
  const mod = await import('./anthropic-api.js')
  const errMod = await import('./errors.js')
  askAnthropicViaApi = mod.askAnthropicViaApi
  AdapterError = errMod.AdapterError
  AnthropicMod = (await import('@anthropic-ai/sdk')).default as unknown as typeof AnthropicMod
})

describe('askAnthropicViaApi (L2 adapter boundary)', () => {
  it('SDK rejects with status 429 → throws AdapterError with category=quota', async () => {
    createMock.mockRejectedValueOnce(new AnthropicMod.APIError(429, 'Rate limited'))
    await expect(askAnthropicViaApi('hi')).rejects.toSatisfy(
      (e: unknown) => e instanceof AdapterError && e.category === 'quota' && e.provider === 'anthropic',
    )
  })

  it('SDK rejects with status 529 → throws AdapterError with category=overloaded', async () => {
    createMock.mockRejectedValueOnce(new AnthropicMod.APIError(529, 'Overloaded'))
    await expect(askAnthropicViaApi('hi')).rejects.toSatisfy(
      (e: unknown) => e instanceof AdapterError && e.category === 'overloaded' && e.retryable === true,
    )
  })

  it('SDK rejects with status 401 → throws AdapterError with category=auth', async () => {
    createMock.mockRejectedValueOnce(new AnthropicMod.APIError(401, 'Unauthorized'))
    await expect(askAnthropicViaApi('hi')).rejects.toSatisfy(
      (e: unknown) => e instanceof AdapterError && e.category === 'auth',
    )
  })
})
