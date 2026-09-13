import './App.css'
import { ModelPanel } from './components/ModelPanel'
import { PromptInput } from './components/PromptInput'
import { useRoundtable } from './hooks/useRoundtable'
import { MODEL_CONFIGS, type ModelId } from './types'

const MODEL_ORDER: ModelId[] = ['openai', 'anthropic', 'google']

export default function App() {
  const { responses, isLoading, submitPrompt, reset } = useRoundtable()

  const hasAnyResponse = MODEL_ORDER.some(
    id => responses[id].status !== 'idle',
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a38] shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-[#e8e8f0] tracking-tight">
            LLM Roundtable
          </h1>
          <p className="text-xs text-[#6b7280]">
            Ask ChatGPT, Claude, and Gemini simultaneously
          </p>
        </div>
        {hasAnyResponse && (
          <button
            onClick={reset}
            className="text-xs text-[#6b7280] hover:text-[#e8e8f0] transition-colors px-3 py-1.5 rounded-lg border border-[#2a2a38] hover:border-[#3a3a50]"
          >
            Clear
          </button>
        )}
      </header>

      {/* Panel grid */}
      <main className="flex-1 overflow-hidden p-4">
        <div className="grid grid-cols-3 gap-4 h-full">
          {MODEL_ORDER.map(modelId => (
            <ModelPanel
              key={modelId}
              config={MODEL_CONFIGS[modelId]}
              response={responses[modelId]}
            />
          ))}
        </div>
      </main>

      {/* Prompt input */}
      <footer className="px-4 pb-4 pt-2 shrink-0">
        <PromptInput onSubmit={submitPrompt} disabled={isLoading} />
      </footer>
    </div>
  )
}
