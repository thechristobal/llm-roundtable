import { useRef, useState } from 'react'
import './App.css'
import ErrorBoundary from './components/ErrorBoundary'
import ProviderPanel from './components/ProviderPanel'
import { type PanelState, type ProviderID } from './types'

const PROVIDER_ORDER: ProviderID[] = ['openai', 'anthropic', 'google']

const INITIAL_STATE: Record<ProviderID, PanelState> = {
  openai: { status: 'idle' },
  anthropic: { status: 'idle' },
  google: { status: 'idle' },
}

export default function App() {
  const [panels, setPanels] = useState<Record<ProviderID, PanelState>>(INITIAL_STATE)
  const [prompt, setPrompt] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const hasResponses = PROVIDER_ORDER.some(id => panels[id].status !== 'idle')

  function handleReset() {
    setPanels(INITIAL_STATE)
    setPrompt('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setPrompt(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  async function handleSubmit() {
    const trimmed = prompt.trim()
    if (!trimmed || isSubmitting) return

    setIsSubmitting(true)
    setPanels({
      openai: { status: 'loading' },
      anthropic: { status: 'loading' },
      google: { status: 'loading' },
    })

    const results = await Promise.allSettled(
      PROVIDER_ORDER.map(async id => {
        const start = Date.now()
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: id, prompt: trimmed }),
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => ({})) as { error?: string }
          throw new Error(errData.error ?? `HTTP ${res.status}`)
        }
        const data = await res.json() as { content: string }
        return { content: data.content, durationMs: Date.now() - start }
      })
    )

    setPanels(prev => {
      const next = { ...prev }
      PROVIDER_ORDER.forEach((id, i) => {
        const result = results[i]
        next[id] =
          result.status === 'fulfilled'
            ? { status: 'complete', content: result.value.content, durationMs: result.value.durationMs }
            : { status: 'error', message: (result.reason instanceof Error && result.reason.message) ? result.reason.message : 'Request failed' }
      })
      return next
    })

    setIsSubmitting(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex flex-col h-full">

      <header className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a38]">
        <div>
          <h1 className="text-lg font-semibold text-[#e8e8f0] tracking-tight">
            LLM Roundtable
          </h1>
          <p className="text-xs text-[#6b7280]">
            Ask ChatGPT, Claude, and Gemini simultaneously
          </p>
        </div>
        {hasResponses && (
          <button
            onClick={handleReset}
            className="text-xs text-[#6b7280] hover:text-[#c9c9d8] transition-colors"
          >
            Clear
          </button>
        )}
      </header>

      <main className="flex-1 overflow-hidden p-4 min-h-0">
        <div className="grid grid-cols-3 gap-4 h-full min-h-0">
          {PROVIDER_ORDER.map(id => (
            <ErrorBoundary key={id}>
              <ProviderPanel providerId={id} state={panels[id]} />
            </ErrorBoundary>
          ))}
        </div>
      </main>

      <footer className="px-4 pb-4 pt-2">
        <div className="flex gap-3 items-end bg-[#17171f] border border-[#2a2a38] rounded-xl p-3">
          <textarea
            ref={textareaRef}
            rows={2}
            value={prompt}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask all three models something..."
            className="flex-1 bg-transparent text-[#e8e8f0] placeholder:text-[#4a4a5a] resize-none outline-none text-sm"
            style={{ minHeight: '3rem', maxHeight: '160px' }}
          />
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !prompt.trim()}
            className="px-5 py-2.5 rounded-lg text-sm font-medium bg-indigo-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Asking...' : 'Submit'}
          </button>
        </div>
      </footer>

    </div>
  )
}
