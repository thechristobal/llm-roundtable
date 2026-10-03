// Hosted-mode gate: Turnstile challenge → mint session JWT → BYO key capture.
//
// Flow:
//   1. No bearer yet → render the Turnstile widget. On success callback we POST
//      /api/token and stash the returned bearer in sessionStorage.
//   2. Bearer present but no BYO keys → render the key capture form. Keys live
//      in sessionStorage (not localStorage — see hostedAuth.ts rationale).
//   3. Both present → render children (the real App).
//
// The Turnstile widget script loads from Cloudflare. The hosted-mode CSP
// (vite.config.ts, 'hosted' mode) allows exactly challenges.cloudflare.com.
import { useEffect, useRef, useState } from 'react'
import { getBearer, getByoKeys, hasAnyByoKey, setBearer, setByoKeys, type ByoKeys } from '../lib/hostedAuth'
import { mintToken } from '../lib/hostedApi'
import { turnstileSiteKey } from '../lib/hostedMode'

type Phase = 'turnstile' | 'byo' | 'ready'

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; 'error-callback'?: () => void }) => string
      remove: (widgetId: string) => void
    }
    onTurnstileLoad?: () => void
  }
}

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

function initialPhase(): Phase {
  if (!getBearer()) return 'turnstile'
  if (!hasAnyByoKey(getByoKeys())) return 'byo'
  return 'ready'
}

export default function HostedGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>(initialPhase)
  const [minting, setMinting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const widgetRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  // Lazy-load the Turnstile script and render the widget when we're in that phase.
  useEffect(() => {
    if (phase !== 'turnstile') return

    const render = () => {
      if (!widgetRef.current || !window.turnstile || widgetIdRef.current) return
      widgetIdRef.current = window.turnstile.render(widgetRef.current, {
        sitekey: turnstileSiteKey(),
        callback: async (token: string) => {
          setMinting(true)
          setError(null)
          try {
            const bearer = await mintToken(token)
            setBearer(bearer)
            setPhase(hasAnyByoKey(getByoKeys()) ? 'ready' : 'byo')
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Token mint failed')
          } finally {
            setMinting(false)
          }
        },
        'error-callback': () => setError('Turnstile challenge failed. Reload to try again.'),
      })
    }

    if (window.turnstile) {
      render()
      return
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', render, { once: true })
      return () => existing.removeEventListener('load', render)
    }

    const script = document.createElement('script')
    script.src = TURNSTILE_SRC
    script.async = true
    script.defer = true
    script.onload = render
    script.onerror = () => setError('Failed to load Turnstile. Check network and reload.')
    document.head.appendChild(script)

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* no-op */ }
        widgetIdRef.current = null
      }
    }
  }, [phase])

  if (phase === 'ready') return <>{children}</>

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a10] p-6">
      <div className="w-full max-w-md bg-[#17171f] border border-[#2a2a38] rounded-xl p-6 shadow-xl">
        <h1 className="text-lg font-semibold text-[#e8e8f0] mb-1">LLM Roundtable Demo</h1>
        <p className="text-xs text-[#6b7280] mb-6">
          A hosted demo of a multi-model debate app. Bring your own API keys —
          they're sent per-request and never stored server-side.
        </p>

        {phase === 'turnstile' && (
          <>
            <p className="text-xs text-[#c9c9d8] mb-3">
              {minting ? 'Minting session…' : 'Confirm you\'re human to continue.'}
            </p>
            <div ref={widgetRef} className="mb-4" />
            {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
          </>
        )}

        {phase === 'byo' && (
          <ByoKeyForm onSaved={() => setPhase('ready')} />
        )}
      </div>
    </div>
  )
}

function ByoKeyForm({ onSaved }: { onSaved: () => void }) {
  const [openai, setOpenai] = useState('')
  const [anthropic, setAnthropic] = useState('')
  const [google, setGoogle] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSave() {
    const keys: ByoKeys = {}
    if (openai.trim()) keys.openai = openai.trim()
    if (anthropic.trim()) keys.anthropic = anthropic.trim()
    if (google.trim()) keys.google = google.trim()
    if (!hasAnyByoKey(keys)) {
      setError('Enter at least one API key to continue.')
      return
    }
    setByoKeys(keys)
    onSaved()
  }

  return (
    <>
      <p className="text-xs text-[#c9c9d8] mb-4">
        Paste any providers you want to debate. Blank fields are skipped.
      </p>
      <div className="flex flex-col gap-3 mb-4">
        <label className="text-xs text-[#6b7280]">
          OpenAI
          <input
            type="password"
            value={openai}
            onChange={e => setOpenai(e.target.value)}
            placeholder="sk-…"
            className="w-full mt-1 bg-[#0a0a10] border border-[#2a2a38] rounded px-2 py-1.5 text-sm text-[#e8e8f0] outline-none focus:border-indigo-500"
          />
        </label>
        <label className="text-xs text-[#6b7280]">
          Anthropic
          <input
            type="password"
            value={anthropic}
            onChange={e => setAnthropic(e.target.value)}
            placeholder="sk-ant-…"
            className="w-full mt-1 bg-[#0a0a10] border border-[#2a2a38] rounded px-2 py-1.5 text-sm text-[#e8e8f0] outline-none focus:border-indigo-500"
          />
        </label>
        <label className="text-xs text-[#6b7280]">
          Google (Gemini)
          <input
            type="password"
            value={google}
            onChange={e => setGoogle(e.target.value)}
            placeholder="AIza…"
            className="w-full mt-1 bg-[#0a0a10] border border-[#2a2a38] rounded px-2 py-1.5 text-sm text-[#e8e8f0] outline-none focus:border-indigo-500"
          />
        </label>
      </div>
      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      <button
        onClick={handleSave}
        className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white"
      >
        Continue
      </button>
      <p className="text-[10px] text-[#4a4a5a] mt-3">
        Keys are stored only in this tab's sessionStorage and sent per-request as
        X-*-Key headers. Closing the tab clears them.
      </p>
    </>
  )
}
