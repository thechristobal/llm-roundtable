import ReactMarkdown from 'react-markdown'
import { PROVIDERS, type PanelState, type ProviderID } from '../types'

type Props = {
  providerId: ProviderID
  state: PanelState
}

export default function ProviderPanel({ providerId, state }: Props) {
  const provider = PROVIDERS[providerId]

  return (
    <div className="rounded-xl border border-[#2a2a38] bg-[#17171f] p-4 flex flex-col h-full min-h-0">
      <p className="text-sm font-semibold mb-3" style={{ color: provider.accentColor }}>
        {provider.name}
      </p>

      <div className="flex-1 overflow-y-auto text-sm text-[#c9c9d8] leading-relaxed min-h-0">
        {state.status === 'idle' && (
          <p className="text-[#4a4a5a]">Waiting for a prompt...</p>
        )}
        {state.status === 'loading' && (
          <p className="text-[#6b7280] animate-pulse">Thinking...</p>
        )}
        {state.status === 'error' && (
          <p className="text-red-400">{state.message}</p>
        )}
        {state.status === 'complete' && (
          <div className="space-y-4">
            {state.rounds.map((round, i) => (
              <div key={i}>
                {i > 0 && (
                  <p className="text-xs text-[#4a4a5a] mb-2 uppercase tracking-wider">
                    Round {i + 1}
                  </p>
                )}
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown>{round}</ReactMarkdown>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
