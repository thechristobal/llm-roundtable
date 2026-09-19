import { useState } from 'react'
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

const DEBATE_ACTIONS = [
  { id: 'fight', label: 'Fight about this' },
  { id: 'consensus', label: 'Seek consensus' },
  { id: 'devils-advocate', label: "Devil's advocate" },
  { id: 'fact-check', label: 'Fact-check each other' },
] as const

export default function App() {
  const [panels, setPanels] = useState<Record<ProviderID, PanelState>>(INITIAL_STATE)
  const [prompt, setPrompt] = useState('')
  const [currentPrompt, setCurrentPrompt] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const allComplete = PROVIDER_ORDER.every(id => panels[id].status === 'complete')

  async function handleSubmit() {
    const trimmed = prompt.trim()
    if (!trimmed || isSubmitting) return

    setIsSubmitting(true)
    setCurrentPrompt(trimmed)
    setPanels({
      openai: { status: 'loading' },
      anthropic: { status: 'loading' },
      google: { status: 'loading' },
    })

    const results = await Promise.allSettled(
      PROVIDER_ORDER.map(id =>
        fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: id, prompt: trimmed }),
        }).then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.json() as Promise<{ content: string }>
        })
      )
    )

    setPanels(prev => {
      const next = { ...prev }
      PROVIDER_ORDER.forEach((id, i) => {
        const result = results[i]
        next[id] =
          result.status === 'fulfilled'
            ? { status: 'complete', content: result.value.content, rounds: [result.value.content] }
            : { status: 'error', message: (result.reason as Error).message }
      })
      return next
    })

    setIsSubmitting(false)
  }

  async function handleDebateRound() {
    if (!allComplete || isSubmitting) return

    const currentResponses: Record<string, string> = {}
    PROVIDER_ORDER.forEach(id => {
      const panel = panels[id]
      if (panel.status === 'complete') currentResponses[id] = panel.content
    })

    setIsSubmitting(true)
    setPanels(prev => {
      const next = { ...prev }
      PROVIDER_ORDER.forEach(id => {
        const panel = prev[id]
        if (panel.status === 'complete') {
          next[id] = { status: 'loading' }
        }
      })
      return next
    })

    const res = await fetch('/api/debate/round', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: currentPrompt, responses: currentResponses }),
    })

    const data = await res.json() as {
      responses: Record<string, string | null>
      errors: Record<string, string>
    }

    setPanels(prev => {
      const next = { ...prev }
      PROVIDER_ORDER.forEach(id => {
        const prevPanel = prev[id]
        const newContent = data.responses[id]
        const error = data.errors?.[id]

        if (error) {
          next[id] = { status: 'error', message: error }
        } else if (newContent) {
          const prevRounds = prevPanel.status === 'complete' ? prevPanel.rounds : []
          next[id] = {
            status: 'complete',
            content: newContent,
            rounds: [...prevRounds, newContent],
          }
        }
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

      <header className="flex items-center px-6 py-4 border-b border-[#2a2a38]">
        <div>
          <h1 className="text-lg font-semibold text-[#e8e8f0] tracking-tight">
            LLM Roundtable
          </h1>
          <p className="text-xs text-[#6b7280]">
            Ask ChatGPT, Claude, and Gemini simultaneously
          </p>
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-4 flex flex-col gap-3 min-h-0">
        <div className="grid grid-cols-3 gap-4 flex-1 min-h-0">
          {PROVIDER_ORDER.map(id => (
            <ErrorBoundary key={id}>
              <ProviderPanel providerId={id} state={panels[id]} />
            </ErrorBoundary>
          ))}
        </div>

        {allComplete && (
          <div className="flex gap-2 justify-center">
            {DEBATE_ACTIONS.map(action => (
              <button
                key={action.id}
                onClick={action.id === 'fight' ? handleDebateRound : undefined}
                disabled={isSubmitting || action.id !== 'fight'}
                className="px-4 py-2 rounded-lg text-xs font-medium border border-[#2a2a38] text-[#c9c9d8] hover:bg-[#2a2a38] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </main>

      <footer className="px-4 pb-4 pt-2">
        <div className="flex gap-3 items-end bg-[#17171f] border border-[#2a2a38] rounded-xl p-3">
          <textarea
            rows={3}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask all three models something..."
            className="flex-1 bg-transparent text-[#e8e8f0] placeholder:text-[#4a4a5a] resize-none outline-none text-sm"
          />
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !prompt.trim()}
            className="px-5 py-2.5 rounded-lg text-sm font-medium bg-indigo-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Asking...' : 'Ask all three'}
          </button>
        </div>
      </footer>

    </div>
  )
}
