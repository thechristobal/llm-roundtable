import type { AdapterErrorWire, AdapterProvider } from '../../../shared/adapter-errors'
import type { PanelState, ProviderID, Round } from '../types'

const KNOWN_PROVIDERS: readonly ProviderID[] = ['openai', 'anthropic', 'google']

function toProvider(id: string): AdapterProvider {
  return (KNOWN_PROVIDERS as readonly string[]).includes(id)
    ? (id as AdapterProvider)
    : 'openai'
}

// Legacy exports (pre-typed-error migration) stored panel errors as
// { status: 'error', message: string }. This is the ONLY place in the app
// that inspects message text — the runtime contract stays wire-only.
function normalizeLegacyPanelError(message: string, providerId: string): AdapterErrorWire {
  const provider = toProvider(providerId)
  const lower = message.toLowerCase()
  if (lower.includes('quota')) {
    return { category: 'quota', provider, message, retryable: false }
  }
  if (lower.includes('high demand') || lower.includes('overloaded')) {
    return { category: 'overloaded', provider, message, retryable: true }
  }
  return { category: 'unknown', provider, message, retryable: false }
}

function normalizePanel(panel: unknown, providerId: string): PanelState {
  if (!panel || typeof panel !== 'object') return { status: 'idle' }
  const s = (panel as { status?: unknown }).status
  if (s === 'loading') return { status: 'loading' }
  if (s === 'complete') {
    const p = panel as { content?: unknown; durationMs?: unknown; model?: unknown }
    return {
      status: 'complete',
      content: typeof p.content === 'string' ? p.content : '',
      durationMs: typeof p.durationMs === 'number' ? p.durationMs : 0,
      ...(typeof p.model === 'string' ? { model: p.model } : {}),
    }
  }
  if (s === 'error') {
    const p = panel as { error?: unknown; message?: unknown }
    // Current shape: { status: 'error', error: AdapterErrorWire }
    if (p.error && typeof p.error === 'object' && 'category' in p.error) {
      return { status: 'error', error: p.error as AdapterErrorWire }
    }
    // Legacy shape: { status: 'error', message: string }
    const legacyMessage = typeof p.message === 'string' ? p.message : 'Unknown error'
    return { status: 'error', error: normalizeLegacyPanelError(legacyMessage, providerId) }
  }
  return { status: 'idle' }
}

function normalizeRound(raw: unknown): Round | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { trigger?: unknown; prompt?: unknown; panels?: unknown }
  if (!r.trigger || !r.panels || typeof r.panels !== 'object') return null
  const panelsIn = r.panels as Record<string, unknown>
  const panels = {} as Record<ProviderID, PanelState>
  for (const id of KNOWN_PROVIDERS) {
    panels[id] = normalizePanel(panelsIn[id], id)
  }
  return {
    trigger: r.trigger as Round['trigger'],
    prompt: (r.prompt === null || typeof r.prompt === 'string') ? r.prompt : null,
    panels,
  }
}

// Pure parse+normalize — extracted so tests don't need the File API.
export function parseRoundtableHtml(text: string): Round[] {
  const match = text.match(/<script type="application\/json" id="roundtable-data">([\s\S]*?)<\/script>/)
  if (!match) throw new Error('No Roundtable data found in this file. Make sure you\'re importing an exported Roundtable HTML file.')

  let parsed: unknown
  try {
    parsed = JSON.parse(match[1])
  } catch {
    throw new Error('Roundtable data in this file is corrupted and could not be parsed.')
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Roundtable data has an unexpected shape. The file may be from an incompatible version.')
  }

  const rounds = parsed.map(normalizeRound).filter((r): r is Round => r !== null)
  if (rounds.length === 0) {
    throw new Error('Roundtable data has an unexpected shape. The file may be from an incompatible version.')
  }
  return rounds
}

export async function importDebate(file: File): Promise<Round[]> {
  const text = await file.text()
  return parseRoundtableHtml(text)
}
