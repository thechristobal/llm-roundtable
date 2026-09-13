import { useRef, type FormEvent, type KeyboardEvent } from 'react'

interface PromptInputProps {
  onSubmit: (prompt: string) => void
  disabled: boolean
}

export function PromptInput({ onSubmit, disabled }: PromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const value = textareaRef.current?.value.trim()
    if (!value || disabled) return
    onSubmit(value)
    if (textareaRef.current) textareaRef.current.value = ''
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e as unknown as FormEvent)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex gap-3 items-end bg-[#17171f] border border-[#2a2a38] rounded-xl p-3 focus-within:border-[#3a3a50] transition-colors"
    >
      <textarea
        ref={textareaRef}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={3}
        placeholder="Ask all three models something... (Enter to send, Shift+Enter for new line)"
        className="flex-1 bg-transparent text-[#e8e8f0] placeholder:text-[#4a4a5a] resize-none outline-none text-sm leading-relaxed disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled}
        className="
          px-5 py-2.5 rounded-lg text-sm font-medium
          bg-indigo-600 hover:bg-indigo-500 text-white
          disabled:opacity-40 disabled:cursor-not-allowed
          transition-colors shrink-0
        "
      >
        {disabled ? 'Asking...' : 'Ask all three'}
      </button>
    </form>
  )
}
