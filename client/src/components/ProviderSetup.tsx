import { useEffect, useRef, useState } from 'react'

type ProviderID = 'openai' | 'anthropic' | 'gemini'
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
}

const ORDER: ProviderID[] = ['openai', 'anthropic', 'gemini']

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
  })
  const [keys, setKeys] = useState<Record<ProviderID, string>>({ openai: '', anthropic: '', gemini: '' })

  // Populate connected status from stored keys on mount
  useEffect(() => {
    window.electronAPI?.getProviderStatus().then(s => {
      setStates(prev => ({
        openai: s.openai ? { status: 'connected' } : prev.openai,
        anthropic: s.anthropic ? { status: 'connected' } : prev.anthropic,
        gemini: s.gemini ? { status: 'connected' } : prev.gemini,
      }))
    })
  }, [])

  const anyConnected = ORDER.some(id => states[id].status === 'connected')

  async function handleSave(id: ProviderID) {
    const key = keys[id].trim()
    if (!key) return
    setStates(prev => ({ ...prev, [id]: { status: 'saving' } }))
    try {
      await window.electronAPI!.setApiKey(id, key)
      setStates(prev => ({ ...prev, [id]: { status: 'connected' } }))
      setKeys(prev => ({ ...prev, [id]: '' }))
    } catch (err) {
      setStates(prev => ({
        ...prev,
        [id]: { status: 'error', message: err instanceof Error ? err.message : 'Failed to save key' },
      }))
    }
  }

  async function handleDisconnect(id: ProviderID) {
    await window.electronAPI?.deleteApiKey(id)
    setStates(prev => ({ ...prev, [id]: { status: 'idle' } }))
  }

  function handleKeyDown(e: React.KeyboardEvent, id: ProviderID) {
    if (e.key === 'Enter') handleSave(id)
  }

  return (
    <div className="flex flex-col h-full bg-[#0f0f17]">
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-2xl">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-[#e8e8f0]">
              {mode === 'settings' ? 'Provider settings' : 'Connect your AI providers'}
            </h1>
            <p className="mt-1 text-sm text-[#6b7280]">
              {mode === 'settings'
                ? 'Manage your API keys. Keys are encrypted with your OS credentials.'
                : 'Connect at least one provider to start. Keys are encrypted locally — never sent to any server.'}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {ORDER.map(id => {
              const p = PROVIDERS[id]
              const s = states[id]
              const isConnected = s.status === 'connected'
              const isSaving = s.status === 'saving'

              return (
                <div
                  key={id}
                  className="rounded-xl border border-[#2a2a38] bg-[#17171f] p-5"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: p.accentColor }}>
                        {p.name}
                      </span>
                      {isConnected && (
                        <span className="text-[10px] text-emerald-400 font-medium bg-emerald-900/20 border border-emerald-800/40 rounded px-1.5 py-0.5">
                          Connected
                        </span>
                      )}
                    </div>
                    {isConnected && mode === 'settings' && (
                      <button
                        onClick={() => handleDisconnect(id)}
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
                          value={keys[id]}
                          onChange={e => setKeys(prev => ({ ...prev, [id]: e.target.value }))}
                          onKeyDown={e => handleKeyDown(e, id)}
                          placeholder={p.keyLabel}
                          disabled={isSaving}
                          className="flex-1 bg-[#0f0f17] border border-[#2a2a38] rounded-lg px-3 py-2 text-sm text-[#e8e8f0] placeholder:text-[#4a4a5a] outline-none focus:border-[#3a3a50] disabled:opacity-50"
                        />
                        <button
                          onClick={() => handleSave(id)}
                          disabled={!keys[id].trim() || isSaving}
                          className="px-4 py-2 rounded-lg text-sm font-medium bg-[#1e1e2e] border border-[#2a2a38] text-[#c9c9d8] hover:border-[#3a3a50] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {isSaving ? 'Checking...' : 'Save'}
                        </button>
                      </div>
                      <p className="text-[11px] text-[#4a4a5a]">{p.keyHint}</p>
                      {s.status === 'error' && (
                        <p className="text-xs text-red-400">{s.message}</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
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
