import 'katex/dist/katex.min.css'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { PROVIDERS, type PanelState, type ProviderID } from '../types'

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Models emit LaTeX with mixed delimiters. Normalize to what remark-math
// expects ($...$ inline, $$...$$ display), and escape currency ranges like
// "$100-$200" so they aren't misread as inline math.
function normalizeMath(text: string): string {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`)
    .replace(/\$([\d.,\s-]+)\$/g, (_, m) => `\\$${m}\\$`)
}

function highlightFabrication(content: string, spans: string[]): string {
  if (!spans.length) return content
  let result = content
  for (const span of spans) {
    const escaped = escapeRegex(span)
    result = result.replace(
      new RegExp(escaped, 'g'),
      `<mark data-jev="fabrication">${span}<span class="jev-fabrication-label" title="Fabrication detection is an experimental feature currently in testing. Jev flagged this span as a possible unverified or misrepresented claim."> [unverified claim — in testing]</span></mark>`
    )
  }
  return result
}

function IconChatGPT({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5C6.76 1.5 5.64 2.03 4.86 2.88A3.25 3.25 0 0 0 2 6.25c0 .56.14 1.08.39 1.54A3.25 3.25 0 0 0 2.5 10.5c0 .87.34 1.66.9 2.25A3.25 3.25 0 0 0 8 14.5a3.25 3.25 0 0 0 4.61-4.46A3.25 3.25 0 0 0 14 7.75a3.25 3.25 0 0 0-2.86-3.22A3.25 3.25 0 0 0 8 1.5z" stroke={color} strokeWidth="1.25" strokeLinejoin="round"/>
      <circle cx="8" cy="8" r="1.5" fill={color}/>
    </svg>
  )
}

function IconClaude({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2L13.5 13H2.5L8 2Z" stroke={color} strokeWidth="1.25" strokeLinejoin="round"/>
      <path d="M5.5 9.5H10.5" stroke={color} strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  )
}

function IconGemini({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1C8 1 9.5 5.5 15 8C9.5 10.5 8 15 8 15C8 15 6.5 10.5 1 8C6.5 5.5 8 1 8 1Z" fill={color}/>
    </svg>
  )
}

const ICONS: Record<ProviderID, ({ color }: { color: string }) => JSX.Element> = {
  openai: IconChatGPT,
  anthropic: IconClaude,
  google: IconGemini,
}

type Props = {
  providerId: ProviderID
  state: PanelState
  onReroll?: () => void
  suspectedFabrication?: string[]
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

export default function ProviderPanel({ providerId, state, onReroll, suspectedFabrication = [] }: Props) {
  const provider = PROVIDERS[providerId]

  return (
    <div className="rounded-xl border border-[#2a2a38] bg-[#17171f] p-4 flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {ICONS[providerId]({ color: provider.accentColor })}
          <div>
            <p className="text-sm font-semibold leading-tight" style={{ color: provider.accentColor }}>
              {provider.name}
            </p>
            {state.status === 'complete' && state.model && (
              <p className="text-[10px] text-[#4a4a5a] leading-tight">{state.model}</p>
            )}
          </div>
        </div>
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
            <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeRaw, rehypeKatex]}>
              {highlightFabrication(normalizeMath(state.content), suspectedFabrication)}
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
