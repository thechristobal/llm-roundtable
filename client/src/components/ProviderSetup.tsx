import { useEffect, useState } from 'react'
import type { ClaudeCliStatus, ProviderStatus } from '../electron'

type ProviderID = 'openai' | 'anthropic' | 'gemini' | 'typesafe'
type ProviderState = { status: 'idle' | 'saving' | 'connected' | 'error'; message?: string }

const PROVIDERS: Record<ProviderID, { name: string; accentColor: string; keyLabel: string; keyHint: string }> = {
  openai: {
    name: 'ChatGPT',
    accentColor: '#10a37f',
    keyLabel: 'OpenAI API key',
    keyHint: 'platform.openai.com → API keys',
  },
  anthropic: {
    name: 'Claude',
    accentColor: '#d97757',
    keyLabel: 'Anthropic API key',
    keyHint: 'console.anthropic.com → API keys',
  },
  gemini: {
    name: 'Gemini',
    accentColor: '#4285f4',
    keyLabel: 'Google AI Studio key',
    keyHint: 'aistudio.google.com → Get API key',
  },
  typesafe: {
    name: 'Jev',
    accentColor: '#a78bfa',
    keyLabel: 'TypeSafe API key',
    keyHint: 'typesafe.ai → API keys. Optional — without a key, Jev runs in demo mode with fixed illustrative scores.',
  },
}

const DEBATER_ORDER: ProviderID[] = ['openai', 'anthropic', 'gemini']

type Props = {
  mode?: 'setup' | 'settings'
  onComplete?: () => void
  onClose?: () => void
}

export default function ProviderSetup({ mode = 'setup', onComplete, onClose }: Props) {
  const [states, setStates] = useState<Record<ProviderID, ProviderState>>({
    openai: { status: 'idle' },
    anthropic: { status: 'idle' },
    gemini: { status: 'idle' },
    typesafe: { status: 'idle' },
  })
  const [keys, setKeys] = useState<Record<ProviderID, string>>({ openai: '', anthropic: '', gemini: '', typesafe: '' })
  const [claudeCli, setClaudeCli] = useState<ClaudeCliStatus>({ present: false, loggedIn: false })
  const [cliEnabled, setCliEnabled] = useState<boolean>(true)
  const [anthropicKey, setAnthropicKey] = useState<boolean>(false)

  useEffect(() => {
    refreshStatus()
  }, [])

  async function refreshStatus() {
    const s: ProviderStatus | undefined = await window.electronAPI?.getProviderStatus()
    if (!s) return
    setStates(prev => ({
      openai: s.openai ? { status: 'connected' } : prev.openai,
      anthropic: s.anthropic ? { status: 'connected' } : { status: 'idle' },
      gemini: s.gemini ? { status: 'connected' } : prev.gemini,
      typesafe: s.typesafe ? { status: 'connected' } : { status: 'idle' },
    }))
    setClaudeCli(s.claudeCli)
    setCliEnabled(s.cliEnabled)
    setAnthropicKey(s.anthropicKey)
  }

  // Continue button only requires a debater — Jev is optional.
  const anyConnected = DEBATER_ORDER.some(id => states[id].status === 'connected')

  async function handleSave(id: ProviderID) {
    const key = keys[id].trim()
    if (!key) return
    setStates(prev => ({ ...prev, [id]: { status: 'saving' } }))
    try {
      await window.electronAPI!.setApiKey(id, key)
      setStates(prev => ({ ...prev, [id]: { status: 'connected' } }))
      setKeys(prev => ({ ...prev, [id]: '' }))
      if (id === 'anthropic') setAnthropicKey(true)
    } catch (err) {
      setStates(prev => ({
        ...prev,
        [id]: { status: 'error', message: err instanceof Error ? err.message : 'Failed to save key' },
      }))
    }
  }

  async function handleDisconnect(id: ProviderID) {
    await window.electronAPI?.deleteApiKey(id)
    if (id === 'anthropic') {
      setAnthropicKey(false)
      // After deleting key, refresh to pick up whether CLI takes over
      await refreshStatus()
    } else {
      setStates(prev => ({ ...prev, [id]: { status: 'idle' } }))
    }
  }

  async function handleRefreshCli() {
    await window.electronAPI?.refreshClaudeCli()
    await refreshStatus()
  }

  function handleKeyDown(e: React.KeyboardEvent, id: ProviderID) {
    if (e.key === 'Enter') handleSave(id)
  }

  return (
    <div className="flex flex-col h-full bg-[#0f0f17]">
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-2xl">
          <div className="mb-8">
            <div className="flex items-baseline justify-between gap-4">
              <h1 className="text-2xl font-semibold text-[#e8e8f0]">
                {mode === 'settings' ? 'Provider settings' : 'Connect your AI providers'}
              </h1>
              {mode === 'settings' && window.electronAPI?.appVersion && (
                <span className="text-xs text-[#6b7280] font-mono">
                  Roundtable v{window.electronAPI.appVersion}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-[#6b7280]">
              {mode === 'settings'
                ? 'Manage your API keys. Keys are encrypted with your OS credentials.'
                : 'Connect at least one provider to start. Keys are encrypted locally — never sent to any server.'}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {DEBATER_ORDER.map(id => {
              if (id === 'anthropic') {
                return (
                  <AnthropicTile
                    key="anthropic"
                    mode={mode}
                    state={states.anthropic}
                    keyValue={keys.anthropic}
                    onKeyChange={v => setKeys(prev => ({ ...prev, anthropic: v }))}
                    onKeyDown={e => handleKeyDown(e, 'anthropic')}
                    onSave={() => handleSave('anthropic')}
                    onDisconnect={() => handleDisconnect('anthropic')}
                    onRefreshCli={handleRefreshCli}
                    onOpenInstall={() => window.electronAPI?.openClaudeCliInstallInstructions()}
                    claudeCli={claudeCli}
                    cliEnabled={cliEnabled}
                    hasApiKey={anthropicKey}
                  />
                )
              }
              return (
                <GenericTile
                  key={id}
                  id={id}
                  mode={mode}
                  state={states[id]}
                  keyValue={keys[id]}
                  onKeyChange={v => setKeys(prev => ({ ...prev, [id]: v }))}
                  onKeyDown={e => handleKeyDown(e, id)}
                  onSave={() => handleSave(id)}
                  onDisconnect={() => handleDisconnect(id)}
                />
              )
            })}
          </div>

          <div className="mt-6 mb-2 flex items-center gap-3">
            <div className="flex-1 h-px bg-[#2a2a38]" />
            <span className="text-[10px] uppercase tracking-wider text-[#6b7280]">Referee (optional)</span>
            <div className="flex-1 h-px bg-[#2a2a38]" />
          </div>

          <div className="flex flex-col gap-4">
            <GenericTile
              id="typesafe"
              mode={mode}
              state={states.typesafe}
              keyValue={keys.typesafe}
              onKeyChange={v => setKeys(prev => ({ ...prev, typesafe: v }))}
              onKeyDown={e => handleKeyDown(e, 'typesafe')}
              onSave={() => handleSave('typesafe')}
              onDisconnect={() => handleDisconnect('typesafe')}
            />
          </div>

          <div className="mt-8 flex justify-end gap-3">
            {mode === 'settings' && onClose && (
              <button
                onClick={onClose}
                className="px-5 py-2 rounded-lg text-sm text-[#6b7280] hover:text-[#c9c9d8] transition-colors"
              >
                Close
              </button>
            )}
            {mode === 'setup' && (
              <button
                onClick={onComplete}
                disabled={!anyConnected}
                className="px-6 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

type GenericTileProps = {
  id: ProviderID
  mode: 'setup' | 'settings'
  state: ProviderState
  keyValue: string
  onKeyChange: (v: string) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onSave: () => void
  onDisconnect: () => void
}

function GenericTile({ id, mode, state, keyValue, onKeyChange, onKeyDown, onSave, onDisconnect }: GenericTileProps) {
  const p = PROVIDERS[id]
  const isConnected = state.status === 'connected'
  const isSaving = state.status === 'saving'

  return (
    <div className="rounded-xl border border-[#2a2a38] bg-[#17171f] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: p.accentColor }}>{p.name}</span>
          {isConnected && (
            <span className="text-[10px] text-emerald-400 font-medium bg-emerald-900/20 border border-emerald-800/40 rounded px-1.5 py-0.5">
              Connected
            </span>
          )}
        </div>
        {isConnected && mode === 'settings' && (
          <button
            onClick={onDisconnect}
            className="text-xs text-[#6b7280] hover:text-red-400 transition-colors"
          >
            Disconnect
          </button>
        )}
      </div>

      {!isConnected && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="password"
              value={keyValue}
              onChange={e => onKeyChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={p.keyLabel}
              disabled={isSaving}
              className="flex-1 bg-[#0f0f17] border border-[#2a2a38] rounded-lg px-3 py-2 text-sm text-[#e8e8f0] placeholder:text-[#4a4a5a] outline-none focus:border-[#3a3a50] disabled:opacity-50"
            />
            <button
              onClick={onSave}
              disabled={!keyValue.trim() || isSaving}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-[#1e1e2e] border border-[#2a2a38] text-[#c9c9d8] hover:border-[#3a3a50] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? 'Checking...' : 'Save'}
            </button>
          </div>
          <p className="text-[11px] text-[#4a4a5a]">{p.keyHint}</p>
          {state.status === 'error' && <p className="text-xs text-red-400">{state.message}</p>}
        </div>
      )}
    </div>
  )
}

type AnthropicTileProps = {
  mode: 'setup' | 'settings'
  state: ProviderState
  keyValue: string
  onKeyChange: (v: string) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onSave: () => void
  onDisconnect: () => void
  onRefreshCli: () => void
  onOpenInstall: () => void
  claudeCli: ClaudeCliStatus
  cliEnabled: boolean
  hasApiKey: boolean
}

function AnthropicTile(props: AnthropicTileProps) {
  const { mode, state, keyValue, onKeyChange, onKeyDown, onSave, onDisconnect, onRefreshCli, onOpenInstall, claudeCli, cliEnabled, hasApiKey } = props
  const p = PROVIDERS.anthropic
  const isSaving = state.status === 'saving'
  const [showKeyInput, setShowKeyInput] = useState(false)

  const cliUsable = cliEnabled && claudeCli.present && claudeCli.loggedIn
  const cliDetectedButLoggedOut = cliEnabled && claudeCli.present && !claudeCli.loggedIn
  const cliMissing = !cliEnabled || !claudeCli.present

  // Determine display mode
  const showKeyConnected = hasApiKey
  const showCliConnected = !hasApiKey && cliUsable
  const showCliLoginPrompt = !hasApiKey && cliDetectedButLoggedOut && !showKeyInput
  const showKeyInputPrimary = !hasApiKey && !cliUsable && !cliDetectedButLoggedOut
  const showKeyInputOverride = !hasApiKey && (cliUsable || cliDetectedButLoggedOut) && showKeyInput

  const subtitle = showKeyConnected
    ? 'via Anthropic API key'
    : showCliConnected
      ? `via Claude Code${claudeCli.subscriptionType ? ` (${claudeCli.subscriptionType})` : ''}`
      : ''

  return (
    <div className="rounded-xl border border-[#2a2a38] bg-[#17171f] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: p.accentColor }}>{p.name}</span>
          {(showKeyConnected || showCliConnected) && (
            <span className="text-[10px] text-emerald-400 font-medium bg-emerald-900/20 border border-emerald-800/40 rounded px-1.5 py-0.5">
              Connected
            </span>
          )}
          {subtitle && <span className="text-[11px] text-[#6b7280]">{subtitle}</span>}
        </div>
        {showKeyConnected && mode === 'settings' && (
          <button
            onClick={onDisconnect}
            className="text-xs text-[#6b7280] hover:text-red-400 transition-colors"
          >
            Disconnect
          </button>
        )}
      </div>

      {showCliConnected && mode === 'settings' && (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-[#4a4a5a]">
            Managed outside Roundtable. Sign out from your terminal: <code className="text-[#6b7280]">claude</code> then <code className="text-[#6b7280]">/logout</code>.
          </p>
          <button
            onClick={() => setShowKeyInput(true)}
            className="text-xs text-[#6b7280] hover:text-[#c9c9d8] transition-colors self-start mt-1"
          >
            Use Anthropic API key instead
          </button>
        </div>
      )}

      {showKeyConnected && cliUsable && mode === 'settings' && (
        <button
          onClick={onDisconnect}
          className="text-xs text-[#6b7280] hover:text-[#c9c9d8] transition-colors mt-1"
        >
          Switch to Claude Code
        </button>
      )}

      {showCliLoginPrompt && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-[#c9c9d8]">Claude Code detected — sign in from your terminal:</p>
          <div className="bg-[#0f0f17] border border-[#2a2a38] rounded-lg p-3 font-mono text-xs text-[#c9c9d8]">
            <div>claude</div>
            <div className="text-[#6b7280]">/login</div>
          </div>
          <div className="flex gap-3 mt-1">
            <button
              onClick={onRefreshCli}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              I've signed in — check again
            </button>
            <button
              onClick={() => setShowKeyInput(true)}
              className="text-xs text-[#6b7280] hover:text-[#c9c9d8] transition-colors"
            >
              Or use an Anthropic API key
            </button>
          </div>
        </div>
      )}

      {(showKeyInputPrimary || showKeyInputOverride) && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="password"
              value={keyValue}
              onChange={e => onKeyChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={p.keyLabel}
              disabled={isSaving}
              className="flex-1 bg-[#0f0f17] border border-[#2a2a38] rounded-lg px-3 py-2 text-sm text-[#e8e8f0] placeholder:text-[#4a4a5a] outline-none focus:border-[#3a3a50] disabled:opacity-50"
            />
            <button
              onClick={onSave}
              disabled={!keyValue.trim() || isSaving}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-[#1e1e2e] border border-[#2a2a38] text-[#c9c9d8] hover:border-[#3a3a50] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? 'Checking...' : 'Save'}
            </button>
          </div>
          <p className="text-[11px] text-[#4a4a5a]">{p.keyHint}</p>
          {state.status === 'error' && <p className="text-xs text-red-400">{state.message}</p>}
          {cliMissing && !showKeyInputOverride && (
            <button
              onClick={onOpenInstall}
              className="text-[11px] text-[#6b7280] hover:text-[#c9c9d8] transition-colors self-start mt-1"
            >
              Or install Claude Code to use your Claude subscription
            </button>
          )}
          {showKeyInputOverride && (
            <button
              onClick={() => setShowKeyInput(false)}
              className="text-[11px] text-[#6b7280] hover:text-[#c9c9d8] transition-colors self-start"
            >
              Cancel — use Claude Code instead
            </button>
          )}
        </div>
      )}
    </div>
  )
}
