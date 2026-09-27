import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import type { AdapterError as AdapterErrorType } from './errors.js'

type FakeChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: (sig?: string) => void
}

const spawnMock = vi.fn<() => FakeChild>()

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...(args as [])),
  execFileSync: vi.fn(() => 'C:\\fake\\claude.cmd\n'),
}))

vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(() => '"C:\\fake\\claude.exe"'),
    existsSync: vi.fn(() => true),
    mkdtempSync: vi.fn(() => 'C:\\tmp\\rt'),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
  },
  readFileSync: vi.fn(() => '"C:\\fake\\claude.exe"'),
  existsSync: vi.fn(() => true),
  mkdtempSync: vi.fn(() => 'C:\\tmp\\rt'),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
}))

function makeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

let askAnthropicViaCli: (prompt: string, systemPrompt?: string) => Promise<string>
let AdapterError: typeof AdapterErrorType

// vi.resetModules() re-imports errors.js, minting a fresh AdapterError class
// each test. Re-import here so instanceof matches the class the adapter throws.
beforeEach(async () => {
  vi.resetModules()
  spawnMock.mockReset()
  const mod = await import('./anthropic-cli.js')
  const errMod = await import('./errors.js')
  askAnthropicViaCli = mod.askAnthropicViaCli
  AdapterError = errMod.AdapterError
})

afterEach(() => {
  vi.useRealTimers()
})

describe('askAnthropicViaCli (L2 adapter boundary)', () => {
  it('CLI returns non-JSON on stdout → AdapterError(category=malformed)', async () => {
    const child = makeChild()
    spawnMock.mockReturnValue(child)
    const promise = askAnthropicViaCli('hi')
    setImmediate(() => {
      child.stdout.emit('data', 'this is not JSON at all')
      child.emit('close', 0)
    })
    await expect(promise).rejects.toSatisfy(
      (e: unknown) => e instanceof AdapterError && e.category === 'malformed' && e.provider === 'anthropic',
    )
  })

  it('CLI JSON result with api_error_status=429 → AdapterError(category=quota)', async () => {
    const child = makeChild()
    spawnMock.mockReturnValue(child)
    const promise = askAnthropicViaCli('hi')
    setImmediate(() => {
      child.stdout.emit('data', JSON.stringify({
        type: 'result',
        subtype: 'error',
        is_error: true,
        api_error_status: 429,
        result: 'rate limited',
      }))
      child.emit('close', 0)
    })
    await expect(promise).rejects.toSatisfy(
      (e: unknown) => e instanceof AdapterError && e.category === 'quota',
    )
  })

  it('CLI spawn fails → AdapterError(category=unknown, provider=anthropic)', async () => {
    const child = makeChild()
    spawnMock.mockReturnValue(child)
    const promise = askAnthropicViaCli('hi')
    setImmediate(() => {
      child.emit('error', new Error('ENOENT: claude not found'))
    })
    await expect(promise).rejects.toSatisfy(
      (e: unknown) => e instanceof AdapterError && e.category === 'unknown' && e.provider === 'anthropic',
    )
  })

  it('CLI hangs past the 120s turn budget → AdapterError(category=timeout) and the child is killed', async () => {
    // Fake timers so we can push the wall clock past TURN_TIMEOUT_MS without
    // burning 120s of real test time. setImmediate is left real so the
    // spawn/promise wiring completes normally before we advance.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const child = makeChild()
    spawnMock.mockReturnValue(child)
    const promise = askAnthropicViaCli('hi')
    // Never emit stdout/close — simulate a hung CLI. Assertion attached before
    // advancing timers so the rejection is observed, not left unhandled.
    const assertion = expect(promise).rejects.toSatisfy(
      (e: unknown) => e instanceof AdapterError && e.category === 'timeout' && e.provider === 'anthropic',
    )
    await vi.advanceTimersByTimeAsync(120_000)
    await assertion
    // The timeout branch must SIGKILL the child so the process doesn't linger.
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })
})
