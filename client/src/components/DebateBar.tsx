import { type DebateAction } from '../types'

type Props = {
  onAction: (action: DebateAction) => void
  disabled: boolean
}

const ACTIONS: { action: DebateAction; label: string; className: string }[] = [
  {
    action: 'fight',
    label: 'Fight about this',
    className: 'border-red-800 text-red-400 hover:bg-red-900/20',
  },
  {
    action: 'seek_consensus',
    label: 'Seek consensus',
    className: 'border-emerald-800 text-emerald-400 hover:bg-emerald-900/20',
  },
]

export default function DebateBar({ onAction, disabled }: Props) {
  return (
    <div className="px-4 py-2 border-t border-[#2a2a38] flex gap-2 shrink-0">
      {ACTIONS.map(({ action, label, className }) => (
        <button
          key={action}
          onClick={() => onAction(action)}
          disabled={disabled}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
