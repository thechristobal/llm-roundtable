import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import './App.css'
import DebateBar from './components/DebateBar'
import ErrorBoundary from './components/ErrorBoundary'
import JevPanel from './components/JevPanel'
import JevRoundScores from './components/JevRoundScores'
import ProviderPanel from './components/ProviderPanel'
import { downloadDebate } from './export'
import { importDebate } from './export/importDebate'
import { type DebateAction, type JevFinalResult, type JevRoundResult, type PanelState, type ProviderID, type Round } from './types'

const PROVIDER_ORDER: ProviderID[] = ['openai', 'anthropic', 'google']

const LOADING_PANELS: Record<ProviderID, PanelState> = {
  openai: { status: 'loading' },
  anthropic: { status: 'loading' },
  google: { status: 'loading' },
}

async function fetchFromEndpoint(url: string, body: object): Promise<{ content: string; durationMs: number }> {
  const start = Date.now()
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errData = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(errData.error ?? `HTTP ${res.status}`)
  }
  const data = await res.json() as { content: string; model?: string }
  return { content: data.content, model: data.model, durationMs: Date.now() - start }
}

function toDebateRounds(rounds: Round[]) {
  return rounds.map(r => ({
    trigger: r.trigger,
    prompt: r.prompt,
    responses: Object.fromEntries(
      PROVIDER_ORDER.map(id => {
        const panel = r.panels[id]
        return [id, panel.status === 'complete' ? panel.content : null]
      })
    ),
  }))
}


function buildJevPayload(jevFinal: JevFinalResult, jevRounds: JevRoundResult[]) {
  if (jevFinal.status !== 'complete') return {}
  return {
    jevFinal: { scores: jevFinal.scores, claimRisk: jevFinal.claimRisk, winner: jevFinal.winner, winnerConfidence: jevFinal.winnerConfidence },
    jevRounds: jevRounds.map(r => r.status === 'complete'
      ? { providers: Object.fromEntries(Object.entries(r.providers).map(([k, v]) => [k, { overall: v!.overall, suspectedFabrication: v!.suspectedFabrication }])) }
      : null
    ),
  }
}

function PromptLabel({ prompt, trigger }: { prompt: string; trigger: Round['trigger'] }) {
  const [expanded, setExpanded] = useState(false)
  const [isLong, setIsLong] = useState(false)
  const textRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    if (!textRef.current) return
    const el = textRef.current
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20
    setIsLong(el.scrollHeight > lineHeight * 1.5)
  }, [prompt])

  if (trigger === 'fight') return <span className="text-xs text-red-400">— Fight</span>
  if (trigger === 'seek_consensus') return <span className="text-xs text-emerald-400">— Seek Consensus</span>

  const color = trigger === 'follow_up' ? 'text-indigo-400' : 'text-[#4a4a5a]'
  const label = trigger === 'follow_up' ? `Follow-up: ${prompt}` : prompt

  return (
    <span className="flex items-start gap-1 text-xs min-w-0 flex-1">
      <span className={`${color} shrink-0`}>—</span>
      <span
        ref={textRef}
        className={`${color} cursor-default ${!expanded && isLong ? 'line-clamp-1' : ''}`}
      >
        {label}
      </span>
      {isLong && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-[#6b7280] hover:text-[#c9c9d8] shrink-0 text-[10px] leading-4 mt-0.5 transition-colors"
        >
          {expanded ? '▲' : '▼'}
        </button>
      )}
    </span>
  )
}

export default function App() {
  const [rounds, setRounds] = useState<Round[]>([])
  const [prompt, setPrompt] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [jevRounds, setJevRounds] = useState<JevRoundResult[]>([])
  const [jevFinal, setJevFinal] = useState<JevFinalResult>({ status: 'idle' })
  const [userVotes, setUserVotes] = useState<Record<number, Set<ProviderID>>>({})

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const judgedRoundsRef = useRef<Set<number>>(new Set())

  const latestRound = rounds[rounds.length - 1] ?? null
  const isLoading = latestRound !== null &&
    PROVIDER_ORDER.some(id => latestRound.panels[id].status === 'loading')
  const hasCompleteRound = latestRound !== null &&
    PROVIDER_ORDER.every(id => latestRound.panels[id].status !== 'loading' && latestRound.panels[id].status !== 'idle')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [rounds])

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (rounds.length > 0 && !window.confirm('Replace the current debate with the imported one?')) return

    try {
      const imported = await importDebate(file)
      setRounds(imported)
      setPrompt('')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Import failed.')
    }
  }

  const judgeRound = useCallback(async (idx: number, round: Round) => {
    setJevRounds(prev => {
      const next = [...prev]
      while (next.length <= idx) next.push({ status: 'idle' })
      next[idx] = { status: 'loading' }
      return next
    })
    try {
      const roundData = {
        trigger: round.trigger,
        prompt: round.prompt,
        responses: Object.fromEntries(
          PROVIDER_ORDER.map(id => [id, round.panels[id].status === 'complete' ? (round.panels[id] as Extract<typeof round.panels[ProviderID], { status: 'complete' }>).content : null])
        ),
      }
      const res = await fetch('/api/judge/round', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ round: roundData, allProviders: PROVIDER_ORDER, isInitial: round.trigger === 'initial' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setJevRounds(prev => {
        const next = [...prev]
        next[idx] = { status: 'complete', providers: data.providers, mock: data.mock ?? false }
        return next
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Evaluation failed'
      setJevRounds(prev => {
        const next = [...prev]
        next[idx] = { status: 'error', message }
        return next
      })
    }
  }, [])

  useEffect(() => {
    rounds.forEach((round, i) => {
      if (judgedRoundsRef.current.has(i)) return
      const allResolved = PROVIDER_ORDER.every(id => {
        const s = round.panels[id].status
        return s === 'complete' || s === 'error'
      })
      if (!allResolved) return
      if (!PROVIDER_ORDER.some(id => round.panels[id].status === 'complete')) return
      judgedRoundsRef.current.add(i)
      judgeRound(i, round)
    })
  }, [rounds, judgeRound])

  async function handleJudge() {
    setJevFinal({ status: 'loading' })
    try {
      const roundsData = toDebateRounds(rounds)
      const res = await fetch('/api/judge/final', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rounds: roundsData, allProviders: PROVIDER_ORDER }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { scores: Record<string, number>; claimRisk: Record<string, number>; winner: string; winnerConfidence: number; mock: boolean }
      setJevFinal({ status: 'complete', scores: data.scores, claimRisk: data.claimRisk, winner: data.winner, winnerConfidence: data.winnerConfidence, mock: data.mock })
    } catch (err) {
      setJevFinal({ status: 'error', message: err instanceof Error ? err.message : 'Judgment failed' })
    }
  }

  function handleReset() {
    setRounds([])
    setPrompt('')
    setJevRounds([])
    setJevFinal({ status: 'idle' })
    setUserVotes({})
    judgedRoundsRef.current.clear()
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
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
    setPrompt('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    const isContinuation = rounds.length > 0
    const newRound: Round = {
      trigger: isContinuation ? 'follow_up' : 'initial',
      prompt: trimmed,
      panels: { ...LOADING_PANELS },
    }
    setRounds(prev => [...prev, newRound])
    const newRoundIdx = rounds.length

    const debateRounds = isContinuation ? toDebateRounds(rounds) : null

    await Promise.all(PROVIDER_ORDER.map(async id => {
      try {
        const result = isContinuation
          ? await fetchFromEndpoint('/api/debate/ask', { provider: id, action: 'follow_up', followUpPrompt: trimmed, rounds: debateRounds, ...buildJevPayload(jevFinal, jevRounds) })
          : await fetchFromEndpoint('/api/ask', { provider: id, prompt: trimmed })
        setRounds(prev => {
          const next = [...prev]
          next[newRoundIdx] = { ...next[newRoundIdx], panels: { ...next[newRoundIdx].panels, [id]: { status: 'complete', content: result.content, durationMs: result.durationMs, model: result.model } } }
          return next
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Request failed'
        setRounds(prev => {
          const next = [...prev]
          next[newRoundIdx] = { ...next[newRoundIdx], panels: { ...next[newRoundIdx].panels, [id]: { status: 'error', message } } }
          return next
        })
      }
    }))

    setIsSubmitting(false)
  }

  async function handleDebateAction(action: DebateAction) {
    if (isLoading) return

    const debateRounds = toDebateRounds(rounds)
    const newRound: Round = { trigger: action, prompt: null, panels: { ...LOADING_PANELS } }
    setRounds(prev => [...prev, newRound])
    const newRoundIdx = rounds.length

    await Promise.all(PROVIDER_ORDER.map(async id => {
      try {
        const result = await fetchFromEndpoint('/api/debate/ask', { provider: id, action, rounds: debateRounds, ...buildJevPayload(jevFinal, jevRounds) })
        setRounds(prev => {
          const next = [...prev]
          next[newRoundIdx] = { ...next[newRoundIdx], panels: { ...next[newRoundIdx].panels, [id]: { status: 'complete', content: result.content, durationMs: result.durationMs, model: result.model } } }
          return next
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Request failed'
        setRounds(prev => {
          const next = [...prev]
          next[newRoundIdx] = { ...next[newRoundIdx], panels: { ...next[newRoundIdx].panels, [id]: { status: 'error', message } } }
          return next
        })
      }
    }))
  }

  async function handleReroll(roundIdx: number, id: ProviderID) {
    const round = rounds[roundIdx]
    if (!round) return

    setRounds(prev => {
      const next = [...prev]
      next[roundIdx] = { ...next[roundIdx], panels: { ...next[roundIdx].panels, [id]: { status: 'loading' } } }
      return next
    })

    try {
      let result: { content: string; durationMs: number }

      if (round.trigger === 'initial') {
        result = await fetchFromEndpoint('/api/ask', { provider: id, prompt: round.prompt! })
      } else {
        const priorRounds = toDebateRounds(rounds.slice(0, roundIdx))
        const body: Record<string, unknown> = { provider: id, action: round.trigger, rounds: priorRounds }
        if (round.trigger === 'follow_up') body.followUpPrompt = round.prompt
        result = await fetchFromEndpoint('/api/debate/ask', body)
      }

      setRounds(prev => {
        const next = [...prev]
        next[roundIdx] = {
          ...next[roundIdx],
          panels: {
            ...next[roundIdx].panels,
            [id]: { status: 'complete', content: result.content, durationMs: result.durationMs, model: result.model },
          },
        }
        return next
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed'
      setRounds(prev => {
        const next = [...prev]
        next[roundIdx] = {
          ...next[roundIdx],
          panels: { ...next[roundIdx].panels, [id]: { status: 'error', message } },
        }
        return next
      })
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex flex-col h-full">

      <header className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a38] shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-[#e8e8f0] tracking-tight">
            LLM Roundtable
          </h1>
          <p className="text-xs text-[#6b7280]">
            Ask ChatGPT, Claude, and Gemini simultaneously
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".html"
            className="hidden"
            onChange={handleImport}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-xs text-[#6b7280] hover:text-[#c9c9d8] transition-colors"
          >
            Import
          </button>
          {rounds.length > 0 && (
            <>
              <button
                onClick={() => downloadDebate('html', rounds)}
                className="text-xs text-[#6b7280] hover:text-[#c9c9d8] transition-colors"
              >
                Export
              </button>
              <button
                onClick={handleReset}
                className="text-xs text-[#6b7280] hover:text-[#c9c9d8] transition-colors"
              >
                Clear
              </button>
            </>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 min-h-0">
        {rounds.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-[#4a4a5a] text-sm">Ask all three models something to get started.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {rounds.map((round, i) => (
              <section key={i}>
                <div className="flex items-center gap-3 mb-3 min-w-0">
                  <span className="text-xs font-medium text-[#6b7280] uppercase tracking-wider shrink-0">
                    {round.trigger === 'initial'
                      ? 'Opening Statements'
                      : `Round ${rounds.slice(0, i + 1).filter(r => r.trigger !== 'initial').length}`}
                  </span>
                  {round.prompt !== null
                    ? <PromptLabel prompt={round.prompt} trigger={round.trigger} />
                    : <PromptLabel prompt="" trigger={round.trigger} />
                  }
                </div>
                <div className="grid grid-cols-3 gap-4 h-96">
                  {PROVIDER_ORDER.map(id => (
                    <ErrorBoundary key={id}>
                      <ProviderPanel
                        providerId={id}
                        state={round.panels[id]}
                        onReroll={i === rounds.length - 1 ? () => handleReroll(i, id) : undefined}
                        suspectedFabrication={jevRounds[i]?.status === 'complete' ? (jevRounds[i].providers[id]?.suspectedFabrication ?? []) : []}
                      />
                    </ErrorBoundary>
                  ))}
                </div>
                <JevRoundScores
                  result={jevRounds[i] ?? { status: 'idle' }}
                  userVotes={userVotes[i] ?? new Set()}
                  onVote={(id) => setUserVotes(prev => {
                    const current = new Set(prev[i])
                    current.has(id) ? current.delete(id) : current.add(id)
                    return { ...prev, [i]: current }
                  })}
                />
              </section>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </main>

      {hasCompleteRound && !isLoading && (
        <DebateBar
          onAction={handleDebateAction}
          disabled={isLoading}
          onJudge={handleJudge}
          judging={jevFinal.status === 'loading'}
        />
      )}
      <JevPanel result={jevFinal} />

      <footer className="px-4 pb-4 pt-2 shrink-0">
        <div className="flex gap-3 items-end bg-[#17171f] border border-[#2a2a38] rounded-xl p-3">
          <textarea
            ref={textareaRef}
            rows={2}
            value={prompt}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={rounds.length > 0 ? 'Add a follow-up question...' : 'Ask all three models something...'}
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
