const MODEL_NAMES: Record<string, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
}

export type DebateAction = 'fight' | 'follow_up'

export type DebateRound = {
  trigger: 'initial' | DebateAction
  prompt: string | null
  responses: Record<string, string | null>
}

export function buildDebateSystemPrompt(
  provider: string,
  allProviders: string[],
  action: DebateAction,
  rounds: DebateRound[],
  followUpPrompt?: string,
): string {
  const self = MODEL_NAMES[provider] ?? provider
  const others = allProviders.filter(p => p !== provider).map(p => MODEL_NAMES[p] ?? p)
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  // Detect which competitors failed in the most recent round
  const latestResponses = rounds[rounds.length - 1]?.responses ?? {}
  const eliminated = allProviders.filter(
    p => p !== provider && (latestResponses[p] === null || latestResponses[p] === '')
  ).map(p => MODEL_NAMES[p] ?? p)

  const debateRoundNum = (upToIdx: number) =>
    rounds.slice(0, upToIdx + 1).filter(r => r.trigger !== 'initial').length

  const history = rounds.map((round, i) => {
    const header = round.trigger === 'initial'
      ? `=== Opening Statements — Original Question: "${round.prompt}" ===`
      : round.trigger === 'follow_up'
        ? `=== Round ${debateRoundNum(i)} — Follow-up: "${round.prompt}" ===`
        : `=== Round ${debateRoundNum(i)} — FIGHT ===`

    const responseBlock = allProviders
      .map(p => {
        const name = MODEL_NAMES[p] ?? p
        const response = round.responses[p]
        return response ? `[${name}]\n${response}` : `[${name}]\n(failed to respond this round)`
      })
      .join('\n\n')

    return `${header}\n\n${responseBlock}`
  }).join('\n\n---\n\n')

  const eliminationNote = eliminated.length > 0
    ? `\nIMPORTANT: ${eliminated.join(' and ')} failed to respond in the most recent round and should be treated as eliminated for now. You may reference their earlier contributions when directly relevant to your argument, but do not default to relitigating their last point just because they cannot respond. If their earlier arguments are no longer relevant to the current thread, ignore them. The debate continues between the remaining active competitors.\n`
    : ''

  let taskDirective: string

  const absentRule = `Do not comment on an unavailable competitor merely because they failed to respond. The UI handles provider status. Only discuss that competitor if a substantive argument from an earlier round remains relevant.`

  if (action === 'fight') {
    taskDirective = `=== Your Task — FIGHT ===

The user has called for a fight round. Challenge the other models directly.

- Identify the single weakest claim or biggest omission in each competitor's last response. Name it explicitly.
- Make your strongest case for why your position is more correct, more complete, or better reasoned.
- Do not restate their positions charitably — find the real weaknesses and press them.
- If you genuinely agree with something a competitor said, say so briefly, then pivot to where you diverge. Do not manufacture disagreement, but do not soften genuine disagreement either.
- Be specific. Vague criticism ("their answer was incomplete") is penalized. Specific criticism ("they claimed X but ignored Y") wins.
- ${absentRule}

Do not ask the user questions. End your response definitively.`
  } else {
    taskDirective = `=== New Question from User ===

The user has introduced a new prompt mid-debate: "${followUpPrompt}"

Answer this new question in the context of everything said so far. You are still competing — compare your answer to your opponents' where it strengthens your case. Do not abandon the debate thread; treat this as a continuation, not a reset.
${absentRule}

Do not ask the user questions. End your response definitively.`
  }

  return `You are ${self}, competing in an LLM Roundtable against ${others.join(' and ')}. Today's date is ${today}.

The full debate history is below. You can now read everything your competitors have written in all previous rounds.
${eliminationNote}
${history}

${taskDirective}`
}
