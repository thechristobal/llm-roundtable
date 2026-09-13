import type { ModelConfig, ModelResponse } from '../types'

interface ModelPanelProps {
  config: ModelConfig
  response: ModelResponse
}

function StatusDot({ status }: { status: ModelResponse['status'] }) {
  if (status === 'idle') return null

  const colors: Record<Exclude<ModelResponse['status'], 'idle'>, string> = {
    loading: 'bg-yellow-400 animate-pulse',
    streaming: 'bg-green-400 animate-pulse',
    complete: 'bg-green-500',
    error: 'bg-red-500',
  }

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[status as Exclude<ModelResponse['status'], 'idle'>]}`}
    />
  )
}

function ResponseContent({ response }: { response: ModelResponse }) {
  if (response.status === 'idle') {
    return (
      <p className="text-[#4a4a5a] text-sm italic select-none">
        Waiting for prompt...
      </p>
    )
  }

  if (response.status === 'loading') {
    return (
      <div className="space-y-2">
        <div className="h-3 bg-[#2a2a38] rounded animate-pulse w-3/4" />
        <div className="h-3 bg-[#2a2a38] rounded animate-pulse w-full" />
        <div className="h-3 bg-[#2a2a38] rounded animate-pulse w-5/6" />
      </div>
    )
  }

  if (response.status === 'error') {
    return (
      <p className="text-red-400 text-sm">
        Error: {response.message}
      </p>
    )
  }

  return (
    <p className="text-[#d0d0e0] text-sm leading-relaxed whitespace-pre-wrap">
      {response.content}
      {response.status === 'streaming' && (
        <span className="inline-block w-0.5 h-4 bg-current ml-0.5 animate-pulse" />
      )}
    </p>
  )
}

export function ModelPanel({ config, response }: ModelPanelProps) {
  const isActive = response.status !== 'idle'

  return (
    <div
      className={`
        flex flex-col rounded-xl border transition-all duration-200
        bg-[#17171f] min-h-[400px]
        ${isActive ? 'border-[#2a2a38] shadow-lg' : 'border-[#1f1f2b]'}
      `}
      style={
        isActive
          ? { boxShadow: `0 0 0 1px ${config.accentColor}22, 0 4px 24px ${config.accentColor}11` }
          : undefined
      }
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b border-[#2a2a38] rounded-t-xl"
        style={{ borderTopColor: isActive ? config.accentColor : 'transparent', borderTopWidth: isActive ? 2 : 0 }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
          style={{ backgroundColor: config.accentColor + '33', color: config.accentColor }}
        >
          {config.name[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#e8e8f0] text-sm">{config.name}</span>
            {response.status !== 'idle' && <StatusDot status={response.status} />}
          </div>
          <span className="text-xs text-[#6b7280]">{config.label}</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 p-4 overflow-y-auto">
        <ResponseContent response={response} />
      </div>
    </div>
  )
}
