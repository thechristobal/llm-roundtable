import rehypeKatex from 'rehype-katex'
import { inlinedKatexCss } from './katex-inlined'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { PROVIDERS } from '../types'
import type { PanelState, ProviderID, Round } from '../types'
import type { Exporter } from './types'

const PROVIDER_ORDER: ProviderID[] = ['openai', 'anthropic', 'google']

async function md2html(content: string): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeKatex)
    .use(rehypeStringify)
    .process(content)
  return String(result)
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function panelErrorHtml(state: Extract<PanelState, { status: 'error' }>, name: string): string {
  const msg = state.message.toLowerCase()
  if (msg.includes('quota')) {
    return `<p class="error-quota"><strong>Quota exhausted — ${name} is out</strong><br>
      <span class="error-sub">Free tier limit reached. The other models continued without ${name}.</span></p>`
  }
  if (msg.includes('high demand')) {
    return `<p class="error-overload"><strong>High demand</strong><br>
      <span class="error-sub">${name} was overloaded.</span></p>`
  }
  return `<p class="error-generic">${state.message}</p>`
}

async function renderPanel(id: ProviderID, state: PanelState): Promise<string> {
  const provider = PROVIDERS[id]
  let headerExtra = ''
  let contentHtml: string

  if (state.status === 'complete') {
    contentHtml = await md2html(state.content)
    headerExtra = `<span class="duration"><span class="check">✓</span> ${formatDuration(state.durationMs)}</span>`
  } else if (state.status === 'loading') {
    contentHtml = `<p class="status-muted">Generating response...</p>`
  } else if (state.status === 'error') {
    contentHtml = panelErrorHtml(state, provider.name)
  } else {
    contentHtml = `<p class="status-muted">No response</p>`
  }

  return `<div class="panel">
      <div class="panel-header">
        <span class="panel-name ${id}">${provider.name}</span>
        ${headerExtra}
      </div>
      <div class="panel-content prose">${contentHtml}</div>
    </div>`
}

function roundLabel(round: Round): { text: string; cls: string } | null {
  if (round.trigger === 'initial' && round.prompt) return { text: `— ${round.prompt}`, cls: 'trigger-initial' }
  if (round.trigger === 'follow_up' && round.prompt) return { text: `— Follow-up: ${round.prompt}`, cls: 'trigger-followup' }
  if (round.trigger === 'fight') return { text: '— Fight', cls: 'trigger-fight' }
  if (round.trigger === 'seek_consensus') return { text: '— Seek Consensus', cls: 'trigger-consensus' }
  return null
}

async function renderRound(round: Round, idx: number): Promise<string> {
  const panels = await Promise.all(PROVIDER_ORDER.map(id => renderPanel(id, round.panels[id])))
  const label = roundLabel(round)

  return `<section class="round">
    <div class="round-header">
      <span class="round-number">Round ${idx + 1}</span>
      ${label ? `<span class="round-label ${label.cls}">${label.text}</span>` : ''}
    </div>
    <div class="panels">${panels.join('')}</div>
  </section>`
}

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: #0e0e14; color: #c9c9d8;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 14px; line-height: 1.6;
  padding: 1.5rem; max-width: 1400px; margin: 0 auto;
}
header { padding-bottom: 1rem; margin-bottom: 2rem; border-bottom: 1px solid #2a2a38; }
header h1 { font-size: 1.125rem; font-weight: 600; color: #e8e8f0; }
header p { font-size: 0.75rem; color: #6b7280; margin-top: 0.25rem; }
.round { margin-bottom: 2.5rem; }
.round-header { display: flex; align-items: baseline; gap: 0.75rem; margin-bottom: 0.75rem; }
.round-number { font-size: 0.75rem; font-weight: 500; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }
.round-label { font-size: 0.75rem; }
.trigger-initial { color: #4a4a5a; }
.trigger-fight { color: #f87171; }
.trigger-consensus { color: #34d399; }
.trigger-followup { color: #818cf8; }
.panels { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
.panel { background: #17171f; border: 1px solid #2a2a38; border-radius: 12px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
.panel-header { display: flex; align-items: center; justify-content: space-between; }
.panel-name { font-weight: 600; font-size: 0.875rem; }
.openai { color: #10a37f; }
.anthropic { color: #d97757; }
.google { color: #4285f4; }
.duration { font-size: 0.75rem; color: #6b7280; display: flex; align-items: center; gap: 0.375rem; }
.check { color: #10b981; }
.panel-content { font-size: 0.875rem; }
.status-muted { color: #4a4a5a; }
.error-quota { color: #f59e0b; }
.error-overload { color: #eab308; }
.error-generic { color: #f87171; }
.error-sub { font-size: 0.75rem; color: #6b7280; }
.prose h1,.prose h2,.prose h3,.prose h4 { color: #e8e8f0; margin: 1rem 0 0.5rem; font-weight: 600; }
.prose h1 { font-size: 1.25rem; } .prose h2 { font-size: 1.125rem; } .prose h3 { font-size: 1rem; }
.prose p { margin: 0.5rem 0; }
.prose ul,.prose ol { padding-left: 1.5rem; margin: 0.5rem 0; }
.prose li { margin: 0.25rem 0; }
.prose code { background: #1e1e2e; border-radius: 4px; padding: 0.125rem 0.375rem; font-size: 0.8125rem; font-family: 'JetBrains Mono','Fira Code',monospace; color: #a8b5e0; }
.prose pre { background: #1e1e2e; border-radius: 8px; padding: 0.75rem 1rem; margin: 0.5rem 0; overflow-x: auto; }
.prose pre code { background: none; padding: 0; }
.prose blockquote { border-left: 3px solid #2a2a38; padding-left: 0.75rem; color: #6b7280; margin: 0.5rem 0; }
.prose strong { color: #e8e8f0; }
.prose a { color: #818cf8; }
.prose table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; overflow-x: auto; display: block; }
.prose th,.prose td { border: 1px solid #2a2a38; padding: 0.375rem 0.75rem; text-align: left; white-space: nowrap; }
.prose th { background: #1e1e2e; color: #e8e8f0; }
@media (max-width: 900px) { .panels { grid-template-columns: 1fr; } }
`

export const htmlExporter: Exporter = {
  mimeType: 'text/html',
  extension: 'html',
  async generate(rounds: Round[], exportedAt: Date): Promise<string> {
    const roundHtmls = await Promise.all(rounds.map((r, i) => renderRound(r, i)))
    const dateStr = exportedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const timeStr = exportedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LLM Roundtable — ${dateStr}</title>
  <style>${inlinedKatexCss}</style>
  <style>${CSS}</style>
</head>
<body>
  <header>
    <h1>LLM Roundtable</h1>
    <p>Exported ${dateStr} at ${timeStr} · ${rounds.length} round${rounds.length !== 1 ? 's' : ''}</p>
  </header>
  ${roundHtmls.join('\n')}
</body>
</html>`
  },
}
