import ReactMarkdown from 'react-markdown'
import { PROVIDERS, type PanelState, type ProviderID } from '../types'

type Props = {
  providerId: ProviderID
  state: PanelState
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

export default function ProviderPanel({ providerId, state }: Props) {
  const provider = PROVIDERS[providerId]

  return (
    <div className="rounded-xl border border-[#2a2a38] bg-[#17171f] p-4 flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold" style={{ color: provider.accentColor }}>
          {provider.name}
        </p>
        {state.status === 'complete' && (
          <span className="flex items-center gap-1.5 text-xs text-[#6b7280]">
            <span className="text-emerald-500">✓</span>
            {formatDuration(state.durationMs)}
          </span>
        )}
        {state.status === 'loading' && (
          <span className="text-xs text-[#6b7280] animate-pulse">Thinking...</span>
        )}
        {state.status === 'error' && (
          <span className="text-xs text-red-500">error</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto text-sm text-[#c9c9d8] leading-relaxed min-h-0">
        {state.status === 'idle' && (
          <p className="text-[#4a4a5a]">Waiting for a prompt...</p>
        )}
        {state.status === 'loading' && (
          <p className="text-[#c9c9d8] animate-pulse text-sm">Generating response...</p>
        )}
        {state.status === 'complete' && (
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown>{state.content}</ReactMarkdown>
          </div>
        )}
        {state.status === 'error' && (
          state.message.toLowerCase().includes('quota') ? (
            <p className="text-amber-400">
              Quota exhausted<br />
              <span className="text-[#6b7280] text-xs">Free tier limit reached. Try again tomorrow or upgrade your API key.</span>
            </p>
          ) : (
            <p className="text-red-400">{state.message}</p>
          )
        )}
      </div>
    </div>
  )
}
