import { useState } from 'react'
import { PROVIDERS, type JevFinalResult, type ProviderID } from '../types'

const PROVIDER_ORDER: ProviderID[] = ['openai', 'anthropic', 'google']

function claimRiskLabel(noul: number): { label: string; cls: string } {
  if (noul < 0.35) return { label: 'Low', cls: 'text-emerald-400' }
  if (noul < 0.65) return { label: 'Medium', cls: 'text-yellow-400' }
  return { label: 'High', cls: 'text-red-400' }
}

export default function JevPanel({ result }: { result: JevFinalResult }) {
  const [minimized, setMinimized] = useState(false)
  const [userVerdict, setUserVerdict] = useState<'agree' | 'disagree' | null>(null)

  if (result.status === 'idle') return null

  return (
    <div className="mx-4 mb-2 border border-[#2a2a38] rounded-xl p-4 bg-[#13131a]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-[#e8e8f0]">Jev's Verdict</span>
        <div className="flex items-center gap-3">
          {result.status === 'complete' && result.mock && (
            <span className="text-[9px] text-[#2a2a38]">mock — TYPESAFE_API_KEY not set</span>
          )}
          {result.status !== 'loading' && (
            <button
              onClick={() => setMinimized(m => !m)}
              className="text-[10px] text-[#6b7280] hover:text-[#c9c9d8] transition-colors"
            >
              {minimized ? '▼' : '▲'}
            </button>
          )}
        </div>
      </div>

      {!minimized && result.status === 'loading' && (
        <p className="text-xs text-[#4a4a5a] animate-pulse">Evaluating full debate...</p>
      )}

      {!minimized && result.status === 'error' && (
        <p className="text-xs text-red-400">{result.message}</p>
      )}

      {!minimized && result.status === 'complete' && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-[10px] text-[#6b7280] uppercase tracking-wider mb-1">Winner</p>
            <div className="flex items-center gap-3">
              {result.winner === 'tie' ? (
                <p className="text-sm text-[#c9c9d8]">
                  Tie
                  <span className="text-xs text-[#6b7280] ml-2">
                    ({Math.round(result.winnerConfidence * 100)}% confidence)
                  </span>
                </p>
              ) : (
                <p className="text-sm font-semibold" style={{ color: PROVIDERS[result.winner as ProviderID]?.accentColor ?? '#e8e8f0' }}>
                  {PROVIDERS[result.winner as ProviderID]?.name ?? result.winner}
                  <span className="text-xs text-[#6b7280] font-normal ml-2">
                    ({Math.round(result.winnerConfidence * 100)}% confidence)
                  </span>
                </p>
              )}
              <div className="flex items-center gap-1.5 ml-auto">
                <button
                  onClick={() => setUserVerdict(v => v === 'agree' ? null : 'agree')}
                  className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                    userVerdict === 'agree'
                      ? 'border-emerald-500 text-emerald-400 font-semibold'
                      : 'border-[#2a2a38] text-[#4a4a5a] hover:text-emerald-400 hover:border-emerald-800'
                  }`}
                >
                  Agree
                </button>
                <button
                  onClick={() => setUserVerdict(v => v === 'disagree' ? null : 'disagree')}
                  className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                    userVerdict === 'disagree'
                      ? 'border-red-500 text-red-400 font-semibold'
                      : 'border-[#2a2a38] text-[#4a4a5a] hover:text-red-400 hover:border-red-800'
                  }`}
                >
                  Disagree
                </button>
              </div>
            </div>
          </div>

          <div>
            <p className="text-[10px] text-[#6b7280] uppercase tracking-wider mb-1">Overall Score</p>
            <div className="flex gap-6">
              {PROVIDER_ORDER.map(id => {
                const score = result.scores[id]
                if (score === undefined) return null
                return (
                  <div key={id}>
                    <span className="text-xs" style={{ color: PROVIDERS[id].accentColor }}>{PROVIDERS[id].name}</span>
                    <span className="text-sm font-medium text-[#e8e8f0] ml-1.5">{score.toFixed(1)}</span>
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <p className="text-[10px] text-[#6b7280] uppercase tracking-wider mb-1">Unsupported Claim Risk</p>
            <div className="flex gap-6">
              {PROVIDER_ORDER.map(id => {
                const risk = result.claimRisk[id]
                if (risk === undefined) return null
                const { label, cls } = claimRiskLabel(risk)
                return (
                  <div key={id}>
                    <span className="text-xs" style={{ color: PROVIDERS[id].accentColor }}>{PROVIDERS[id].name}</span>
                    <span className={`text-xs font-medium ml-1.5 ${cls}`}>{label}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
