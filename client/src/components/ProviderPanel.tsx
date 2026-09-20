import 'katex/dist/katex.min.css'
import rehypeKatex from 'rehype-katex'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { PROVIDERS, type PanelState, type ProviderID } from '../types'

type Props = {
  providerId: ProviderID
  state: PanelState
  onReroll?: () => void
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

export default function ProviderPanel({ providerId, state, onReroll }: Props) {
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
            <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
              {state.content}
            </ReactMarkdown>
          </div>
        )}
        {state.status === 'error' && (
          <div className="flex flex-col gap-3">
            {state.message.toLowerCase().includes('quota') ? (
              <div>
                <p className="text-amber-400 font-medium">Quota exhausted — {provider.name} is out</p>
                <p className="text-[#6b7280] text-xs mt-1">
                  Free tier limit reached. The other models will continue the debate without {provider.name}.
                </p>
              </div>
            ) : state.message.toLowerCase().includes('high demand') ? (
              <div>
                <p className="text-yellow-400 font-medium">High demand</p>
                <p className="text-[#6b7280] text-xs mt-1">
                  {provider.name} is overloaded. Retry or continue the debate without it.
                </p>
              </div>
            ) : (
              <p className="text-red-400">{state.message}</p>
            )}
            {onReroll && (
              <button
                onClick={onReroll}
                className="self-start text-xs text-[#6b7280] hover:text-[#c9c9d8] border border-[#2a2a38] hover:border-[#3a3a50] rounded px-2 py-1 transition-colors"
              >
                ↺ Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
