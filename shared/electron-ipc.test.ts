import { describe, expectTypeOf, test } from 'vitest'
import type {
  AsyncArgs,
  AsyncChannel,
  AsyncResult,
  ClaudeBackend,
  ClaudeCliStatus,
  ElectronAPI,
  ProviderStatus,
  RefreshClaudeCliResult,
  SyncChannel,
  SyncResult,
} from './electron-ipc'

// These are compile-time characterization tests: if the contract or
// downstream types drift from what electron/main.ts, electron/preload.ts,
// and client/src/electron.d.ts expected as of C5, tsc fails and the test
// runner reports it. The runtime bodies are trivial — the assertion lives
// in the type parameter to expectTypeOf.

describe('IpcAsyncContract', () => {
  test('registers exactly the 7 async channels currently handled by main.ts', () => {
    // Exhaustive object keyed by AsyncChannel — omitting a channel or adding
    // an extra one both fail to compile. This is the single guarantee that
    // the contract covers every ipcMain.handle in electron/main.ts.
    const channels: Record<AsyncChannel, true> = {
      'get-provider-status': true,
      'set-api-key': true,
      'delete-api-key': true,
      'check-codex-auth': true,
      'open-codex-login-instructions': true,
      'refresh-claude-cli': true,
      'open-claude-cli-install-instructions': true,
    }
    expectTypeOf<AsyncChannel>().toEqualTypeOf<keyof typeof channels>()
  })

  test('get-provider-status: () → ProviderStatus', () => {
    expectTypeOf<AsyncArgs<'get-provider-status'>>().toEqualTypeOf<[]>()
    expectTypeOf<AsyncResult<'get-provider-status'>>().toEqualTypeOf<ProviderStatus>()
  })

  test('set-api-key: (provider: string, key: string) → void', () => {
    expectTypeOf<AsyncArgs<'set-api-key'>>().toEqualTypeOf<[provider: string, key: string]>()
    expectTypeOf<AsyncResult<'set-api-key'>>().toEqualTypeOf<void>()
  })

  test('delete-api-key: (provider: string) → void', () => {
    expectTypeOf<AsyncArgs<'delete-api-key'>>().toEqualTypeOf<[provider: string]>()
    expectTypeOf<AsyncResult<'delete-api-key'>>().toEqualTypeOf<void>()
  })

  test('check-codex-auth: () → boolean', () => {
    expectTypeOf<AsyncArgs<'check-codex-auth'>>().toEqualTypeOf<[]>()
    expectTypeOf<AsyncResult<'check-codex-auth'>>().toEqualTypeOf<boolean>()
  })

  test('open-codex-login-instructions: () → void', () => {
    expectTypeOf<AsyncArgs<'open-codex-login-instructions'>>().toEqualTypeOf<[]>()
    expectTypeOf<AsyncResult<'open-codex-login-instructions'>>().toEqualTypeOf<void>()
  })

  test('refresh-claude-cli: () → { claudeCli, backend }', () => {
    expectTypeOf<AsyncArgs<'refresh-claude-cli'>>().toEqualTypeOf<[]>()
    expectTypeOf<AsyncResult<'refresh-claude-cli'>>().toEqualTypeOf<RefreshClaudeCliResult>()
    expectTypeOf<RefreshClaudeCliResult>().toEqualTypeOf<{
      claudeCli: ClaudeCliStatus
      backend: ClaudeBackend
    }>()
  })

  test('open-claude-cli-install-instructions: () → void', () => {
    expectTypeOf<AsyncArgs<'open-claude-cli-install-instructions'>>().toEqualTypeOf<[]>()
    expectTypeOf<AsyncResult<'open-claude-cli-install-instructions'>>().toEqualTypeOf<void>()
  })
})

describe('IpcSyncContract', () => {
  test('registers exactly the 2 sync channels currently handled by main.ts', () => {
    const channels: Record<SyncChannel, true> = {
      'get-server-port': true,
      'get-app-version': true,
    }
    expectTypeOf<SyncChannel>().toEqualTypeOf<keyof typeof channels>()
  })

  test('get-server-port → number', () => {
    expectTypeOf<SyncResult<'get-server-port'>>().toEqualTypeOf<number>()
  })

  test('get-app-version → string', () => {
    expectTypeOf<SyncResult<'get-app-version'>>().toEqualTypeOf<string>()
  })
})

describe('ElectronAPI (window.electronAPI shape)', () => {
  test('exposes exactly the 9 fields currently on window.electronAPI (2 sync-loaded + 7 methods)', () => {
    type ExpectedKeys =
      | 'serverPort'
      | 'appVersion'
      | 'getProviderStatus'
      | 'setApiKey'
      | 'deleteApiKey'
      | 'checkCodexAuth'
      | 'openCodexLoginInstructions'
      | 'refreshClaudeCli'
      | 'openClaudeCliInstallInstructions'
    expectTypeOf<keyof ElectronAPI>().toEqualTypeOf<ExpectedKeys>()
  })

  test('serverPort: number and appVersion: string (loaded via sendSync at preload time)', () => {
    expectTypeOf<ElectronAPI['serverPort']>().toEqualTypeOf<number>()
    expectTypeOf<ElectronAPI['appVersion']>().toEqualTypeOf<string>()
  })

  test('getProviderStatus: () → Promise<ProviderStatus>', () => {
    expectTypeOf<ElectronAPI['getProviderStatus']>().parameters.toEqualTypeOf<[]>()
    expectTypeOf<ElectronAPI['getProviderStatus']>().returns.resolves.toEqualTypeOf<ProviderStatus>()
  })

  test('setApiKey: (provider: string, key: string) → Promise<void>', () => {
    expectTypeOf<ElectronAPI['setApiKey']>().parameters.toEqualTypeOf<[provider: string, key: string]>()
    expectTypeOf<ElectronAPI['setApiKey']>().returns.resolves.toEqualTypeOf<void>()
  })

  test('deleteApiKey: (provider: string) → Promise<void>', () => {
    expectTypeOf<ElectronAPI['deleteApiKey']>().parameters.toEqualTypeOf<[provider: string]>()
    expectTypeOf<ElectronAPI['deleteApiKey']>().returns.resolves.toEqualTypeOf<void>()
  })

  test('checkCodexAuth: () → Promise<boolean>', () => {
    expectTypeOf<ElectronAPI['checkCodexAuth']>().parameters.toEqualTypeOf<[]>()
    expectTypeOf<ElectronAPI['checkCodexAuth']>().returns.resolves.toEqualTypeOf<boolean>()
  })

  test('openCodexLoginInstructions: () → Promise<void>', () => {
    expectTypeOf<ElectronAPI['openCodexLoginInstructions']>().parameters.toEqualTypeOf<[]>()
    expectTypeOf<ElectronAPI['openCodexLoginInstructions']>().returns.resolves.toEqualTypeOf<void>()
  })

  test('refreshClaudeCli: () → Promise<RefreshClaudeCliResult>', () => {
    expectTypeOf<ElectronAPI['refreshClaudeCli']>().parameters.toEqualTypeOf<[]>()
    expectTypeOf<ElectronAPI['refreshClaudeCli']>().returns.resolves.toEqualTypeOf<RefreshClaudeCliResult>()
  })

  test('openClaudeCliInstallInstructions: () → Promise<void>', () => {
    expectTypeOf<ElectronAPI['openClaudeCliInstallInstructions']>().parameters.toEqualTypeOf<[]>()
    expectTypeOf<ElectronAPI['openClaudeCliInstallInstructions']>().returns.resolves.toEqualTypeOf<void>()
  })
})

describe('shared types', () => {
  test('ClaudeCliStatus: required present + loggedIn, optional authMethod + subscriptionType', () => {
    expectTypeOf<ClaudeCliStatus>().toEqualTypeOf<{
      present: boolean
      loggedIn: boolean
      authMethod?: string
      subscriptionType?: string
    }>()
  })

  test('ProviderStatus: 7 booleans + claudeCli nested + cliEnabled', () => {
    expectTypeOf<ProviderStatus>().toEqualTypeOf<{
      openai: boolean
      anthropic: boolean
      anthropicKey: boolean
      gemini: boolean
      typesafe: boolean
      codexAuth: boolean
      claudeCli: ClaudeCliStatus
      cliEnabled: boolean
    }>()
  })

  test('ClaudeBackend union: cli | api | none', () => {
    expectTypeOf<ClaudeBackend>().toEqualTypeOf<'cli' | 'api' | 'none'>()
  })
})
