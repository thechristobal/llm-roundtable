import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AdapterError as AdapterErrorType } from './errors.js'

const generateContentMock = vi.fn()
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: generateContentMock }
    }
  },
}))

let askGoogle: (prompt: string, systemPrompt?: string) => Promise<string>
let AdapterError: typeof AdapterErrorType

// vi.resetModules() re-imports errors.js, minting a fresh AdapterError class
// each test. Re-import here so instanceof matches the class the adapter throws.
beforeEach(async () => {
  vi.resetModules()
  generateContentMock.mockReset()
  const mod = await import('./google.js')
  const errMod = await import('./errors.js')
  askGoogle = mod.askGoogle
  AdapterError = errMod.AdapterError
})

afterEach(() => {
  vi.useRealTimers()
})

describe('askGoogle (L2 adapter boundary)', () => {
  it('SDK throws "503 Service Unavailable" (persistently) → AdapterError(category=overloaded) after exactly 6 attempts', async () => {
    vi.useFakeTimers()
    // askGoogle retries up to 6 times with growing backoff; fake-timers so the
    // retry loop drains instantly instead of waiting ~45s of real time.
    generateContentMock.mockRejectedValue(new Error('503 Service Unavailable'))
    const promise = askGoogle('hi')
    // Attach handler now so the eventual rejection is observed (avoids
    // unhandled-rejection warnings while we drain timers).
    const assertion = expect(promise).rejects.toSatisfy(
      (e: unknown) => e instanceof AdapterError && e.category === 'overloaded' && e.provider === 'google',
    )
    await vi.runAllTimersAsync()
    await assertion
    // The retry loop is the load-bearing invariant: if maxRetries is silently
    // changed or the loop is unbounded, the call count is the only signal.
    expect(generateContentMock).toHaveBeenCalledTimes(6)
  })

  it('SDK throws "429 quota exceeded" → AdapterError(category=quota) on first attempt (quota is permanent, must NOT retry)', async () => {
    generateContentMock.mockRejectedValue(new Error('429 quota exceeded'))
    await expect(askGoogle('hi')).rejects.toSatisfy(
      (e: unknown) => e instanceof AdapterError && e.category === 'quota',
    )
    // Quota must be non-retryable at the adapter level; a bug that treats
    // quota as transient would show up as calls > 1.
    expect(generateContentMock).toHaveBeenCalledTimes(1)
  })

  it('SDK throws random error → AdapterError(category=unknown) on first attempt (unknown is permanent)', async () => {
    // A non-transient, non-quota, non-auth error stops retries via isPermanent.
    // Message must not match any classifier pattern (no "unauthorized",
    // "quota", "503", etc.) or it would land in a different category.
    generateContentMock.mockRejectedValue(new Error('completely unexpected condition xyz'))
    await expect(askGoogle('hi')).rejects.toSatisfy(
      (e: unknown) => e instanceof AdapterError && e.category === 'unknown',
    )
    expect(generateContentMock).toHaveBeenCalledTimes(1)
  })
})
