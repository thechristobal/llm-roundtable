import { buildDebateSystemPrompt, type DebateAction, type DebateRound } from '../../../server/src/debatePrompt.js'
import { AdapterError } from '../../../server/src/adapters/errors.js'
import { DEMO_CAPS } from '../config/demo.js'
import { askAnthropic } from '../providers/anthropic.js'
import { askGoogle } from '../providers/google.js'
import { askOpenAI } from '../providers/openai.js'
import type { DemoCredentials, ProviderCompleteEvent, ProviderID, StreamEvent } from '../types.js'

export interface OrchestrateArgs {
  action: DebateAction | 'opening'
  prompt: string
  rounds: DebateRound[]
  credentials: DemoCredentials
}

const ALL_PROVIDERS: readonly ProviderID[] = ['openai', 'anthropic', 'google']

// `opening` isn't a debate action in debatePrompt.ts — the opening-statement
// path doesn't build a system prompt from history; providers just get the
// user prompt as-is. We model opening as a flat fan-out so the orchestrator
// has one code path.
function buildSystemPrompt(action: DebateAction | 'opening', rounds: DebateRound[], provider: ProviderID): string | undefined {
  if (action === 'opening') return undefined
  return buildDebateSystemPrompt(provider, [...ALL_PROVIDERS], action, rounds)
}

function askProvider(
  provider: ProviderID,
  apiKey: string,
  prompt: string,
  systemPrompt: string | undefined,
  signal: AbortSignal,
) {
  const args = {
    apiKey,
    prompt,
    ...(systemPrompt ? { systemPrompt } : {}),
    maxOutputTokens: DEMO_CAPS.perProviderMaxOutputTokens,
    signal,
  }
  switch (provider) {
    case 'openai': return askOpenAI(args)
    case 'anthropic': return askAnthropic(args)
    case 'google': return askGoogle(args)
  }
}

function truncate(content: string): string {
  const cap = DEMO_CAPS.perProviderResponseByteCap
  const buf = Buffer.from(content, 'utf8')
  if (buf.byteLength <= cap) return content
  // Decode may land mid-codepoint; the final-byte sanity trim handles stragglers.
  return buf.subarray(0, cap).toString('utf8').replace(/�+$/u, '')
}

function missingKeyEvent(provider: ProviderID): ProviderCompleteEvent {
  return {
    type: 'provider_complete',
    provider,
    ok: false,
    error: {
      category: 'auth',
      message: `Missing ${provider} API key — supply X-${provider[0]!.toUpperCase() + provider.slice(1)}-Key header`,
      retryable: false,
    },
  }
}

function isAbort(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: unknown }).name
  return name === 'AbortError' || name === 'APIUserAbortError'
}

function errorEvent(provider: ProviderID, err: unknown, aborted: boolean): ProviderCompleteEvent {
  if (aborted || isAbort(err)) {
    return {
      type: 'provider_complete',
      provider,
      ok: false,
      error: { category: 'timeout', message: 'Provider exceeded orchestration deadline', retryable: true },
    }
  }
  if (err instanceof AdapterError) {
    return {
      type: 'provider_complete',
      provider,
      ok: false,
      error: { category: err.category, message: err.message, retryable: err.retryable },
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  return {
    type: 'provider_complete',
    provider,
    ok: false,
    error: { category: 'unknown', message, retryable: false },
  }
}

// Yields StreamEvents in real time: `start` → interleaved `provider_complete`
// and `heartbeat` → `done`. Caller (handler) serializes events to the stream.
// Deadline is enforced via AbortController; providers that didn't resolve by
// then emit a timeout `provider_complete`.
export async function* orchestrate(args: OrchestrateArgs): AsyncGenerator<StreamEvent> {
  yield { type: 'start', ts: Date.now() }

  const controller = new AbortController()
  const deadlineTimer = setTimeout(() => controller.abort(), DEMO_CAPS.orchestrationDeadlineMs)

  const providerPrompt = args.action === 'opening' ? args.prompt : 'Continue the debate.'

  const inflight = new Map<ProviderID, Promise<ProviderCompleteEvent>>()
  for (const provider of ALL_PROVIDERS) {
    const apiKey = args.credentials[provider]
    if (!apiKey) {
      inflight.set(provider, Promise.resolve(missingKeyEvent(provider)))
      continue
    }
    const systemPrompt = buildSystemPrompt(args.action, args.rounds, provider)
    const promise = askProvider(provider, apiKey, providerPrompt, systemPrompt, controller.signal)
      .then((result): ProviderCompleteEvent => ({
        type: 'provider_complete',
        provider,
        ok: true,
        content: truncate(result.content),
        model: result.model,
      }))
      .catch((err): ProviderCompleteEvent => errorEvent(provider, err, controller.signal.aborted))
    inflight.set(provider, promise)
  }

  try {
    // Race heartbeat timer against the next completing provider. First settled
    // either yields a provider_complete and removes it from inflight, or yields
    // a heartbeat and loops.
    while (inflight.size > 0) {
      let heartbeatResolve!: () => void
      const heartbeat = new Promise<'heartbeat'>(res => {
        heartbeatResolve = () => res('heartbeat')
      })
      const heartbeatTimer = setTimeout(heartbeatResolve, DEMO_CAPS.heartbeatIntervalMs)

      const providerRaces = Array.from(inflight.entries()).map(
        ([provider, p]) => p.then(evt => ({ provider, evt })),
      )

      const settled = await Promise.race<
        { provider: ProviderID; evt: ProviderCompleteEvent } | 'heartbeat'
      >([heartbeat, ...providerRaces])

      clearTimeout(heartbeatTimer)

      if (settled === 'heartbeat') {
        yield { type: 'heartbeat', ts: Date.now() }
        continue
      }
      inflight.delete(settled.provider)
      yield settled.evt
    }
  } finally {
    clearTimeout(deadlineTimer)
  }

  yield { type: 'done', ts: Date.now() }
}
