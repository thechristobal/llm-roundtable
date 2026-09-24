import { PROVIDERS, type JevProviderRound, type JevRoundResult, type ProviderID } from '../types'

const PROVIDER_ORDER: ProviderID[] = ['openai', 'anthropic', 'google']

const DIMS: { key: keyof Pick<JevProviderRound, 'reasoning' | 'coherence' | 'evidence' | 'honesty'>; label: string }[] = [
  { key: 'reasoning', label: 'Reasoning' },
  { key: 'honesty', label: 'Intellectual Honesty' },
  { key: 'evidence', label: 'Precision' },
  { key: 'coherence', label: 'Coherence' },
]

type Props = {
  result: JevRoundResult
  userVotes: Set<ProviderID>
  onVote: (id: ProviderID) => void
}

export default function JevRoundScores({ result, userVotes, onVote }: Props) {
  if (result.status === 'idle') return null

  return (
    <div className="mt-2 border border-[#2a2a38] rounded-lg px-3 py-2 bg-[#13131a]">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-[10px] font-semibold text-[#6b7280] shrink-0 uppercase tracking-wider">
          Jev's Scorecard
        </span>
        {result.status === 'loading' && (
          <span className="text-xs text-[#4a4a5a] animate-pulse">Evaluating...</span>
        )}
        {result.status === 'error' && (
          <span className="text-xs text-red-500 truncate">{result.message}</span>
        )}
        {result.status === 'complete' && result.mock && (
          <span className="text-[9px] text-[#4a4a5a]">demo</span>
        )}
      </div>

      {result.status === 'complete' && (
        <div className="mt-2 grid grid-cols-3 gap-3 border-t border-[#1e1e2e] pt-2">
          {PROVIDER_ORDER.map(id => {
            const p = result.providers[id]
            if (!p) return null
            return (
              <div key={id} className="flex flex-col gap-0.5">
                <span className="text-[10px] font-medium mb-0.5" style={{ color: PROVIDERS[id].accentColor }}>
                  {PROVIDERS[id].name}
                  {p.contradictionDetected && <span className="ml-1 text-orange-400">⚠ contradiction</span>}
                {p.fabricationDetected && (
                  <span
                    className="ml-1 text-red-400 cursor-help"
                    title="Fabrication detection is an experimental feature currently in testing. This flag means Jev detected a possible unverified or misrepresented claim — treat it as a prompt for scrutiny, not a definitive finding."
                  >
                    ⚠ fabrication
                  </span>
                )}
                </span>
                {DIMS.map(({ key, label }) => {
                  const isEq = key === 'evidence'
                  const anchored = isEq && p.eqAnchored
                  return (
                    <div key={key} className="flex justify-between text-[10px]">
                      <span className="text-[#4a4a5a]">{label}</span>
                      <span className={anchored ? 'text-[#4a4a5a]' : 'text-[#c9c9d8]'}>
                        {p[key].score.toFixed(1)}
                        {anchored && <span className="ml-0.5 text-[9px]">~</span>}
                      </span>
                    </div>
                  )
                })}
                {(() => {
                  const failed = p.relevance.noul >= 0.5
                  return (
                    <div className="flex justify-between text-[10px]">
                      <span className="text-[#4a4a5a]">Task Adherence</span>
                      <span className={failed ? 'text-red-400 font-medium' : 'text-emerald-400 font-medium'}>
                        {failed ? 'Fail' : 'Pass'}
                      </span>
                    </div>
                  )
                })()}
                <div className="flex justify-between text-[10px] border-t border-[#1e1e2e] mt-1 pt-1">
                  <span className="text-[#6b7280] font-medium">Overall</span>
                  {p.disqualified ? (
                    <span
                      className="text-red-400 font-semibold cursor-help"
                      title="Disqualified for this round: response failed Task Adherence and is ineligible to win regardless of dimension scores. Whole-debate Judge may still consider recovery in later rounds."
                    >
                      DQ
                    </span>
                  ) : (
                    <span className="text-[#e8e8f0] font-semibold">{p.overall.toFixed(1)}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[#1e1e2e]">
        <span className="text-[10px] text-[#4a4a5a] shrink-0">Your pick</span>
        {PROVIDER_ORDER.map(id => {
          const selected = userVotes.has(id)
          return (
            <button
              key={id}
              onClick={() => onVote(id)}
              className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                selected
                  ? 'border-current font-semibold'
                  : 'border-[#2a2a38] text-[#4a4a5a] hover:text-[#6b7280] hover:border-[#3a3a50]'
              }`}
              style={selected ? { color: PROVIDERS[id].accentColor, borderColor: PROVIDERS[id].accentColor } : {}}
            >
              {PROVIDERS[id].name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
