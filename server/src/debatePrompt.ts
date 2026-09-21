const MODEL_NAMES: Record<string, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
}

export type DebateAction = 'fight' | 'follow_up' | 'seek_consensus'

export type DebateRound = {
  trigger: 'initial' | DebateAction
  prompt: string | null
  responses: Record<string, string | null>
}

export type JevRoundContext = {
  providers: Record<string, { overall: number; suspectedFabrication?: string[] }>
}

export type JevFinalContext = {
  scores: Record<string, number>
  claimRisk: Record<string, number>
  winner: string
  winnerConfidence: number
}

export function buildDebateSystemPrompt(
  provider: string,
  allProviders: string[],
  action: DebateAction,
  rounds: DebateRound[],
  followUpPrompt?: string,
  jevFinal?: JevFinalContext,
  jevRounds?: (JevRoundContext | null)[],
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

  if (action === 'seek_consensus') {
    taskDirective = `=== Your Task — SEEK CONSENSUS ===

The user has asked the panel to find common ground. Your goal is to converge, not to win.

- Identify the claims or positions where you and your competitors genuinely agree. State them plainly.
- For points where you have previously disagreed: look for the kernel of truth in the other side. Acknowledge it explicitly.
- Make concessions where the evidence or reasoning warrants them. Changing your position when faced with a better argument is strength, not weakness.
- If you still hold a position after honest consideration, say so briefly — but do not defend it combatively. Frame it as an open question rather than a firm conclusion.
- End with a short summary of where the panel appears to have landed and what, if anything, remains genuinely unresolved.
- ${absentRule}

Do not ask the user questions. End your response definitively.`
  } else if (action === 'fight') {
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

  let jevBlock = ''
  if (jevFinal) {
    const winnerName = MODEL_NAMES[jevFinal.winner] ?? jevFinal.winner
    const scoreList = allProviders
      .filter(p => jevFinal.scores[p] !== undefined)
      .map(p => `${MODEL_NAMES[p] ?? p} ${jevFinal.scores[p].toFixed(1)}`)
      .join(' | ')
    const riskList = allProviders
      .filter(p => jevFinal.claimRisk[p] !== undefined)
      .map(p => {
        const r = jevFinal.claimRisk[p]
        const label = r < 0.35 ? 'Low' : r < 0.65 ? 'Medium' : 'High'
        return `${MODEL_NAMES[p] ?? p} ${label}`
      })
      .join(' | ')

    const roundLines = jevRounds
      ? jevRounds.map((jr, i) => {
          if (!jr) return null
          const label = i === 0 ? 'Opening Statements' : `Round ${i}`
          const scores = allProviders
            .filter(p => jr.providers[p] !== undefined)
            .map(p => `${MODEL_NAMES[p] ?? p} ${jr.providers[p].overall.toFixed(1)}`)
            .join(' | ')
          return `  ${label}: ${scores}`
        }).filter(Boolean).join('\n')
      : null

    jevBlock = `
=== Jev's Independent Judgment (revealed to all contestants) ===
An independent AI judge (Jev) has evaluated this debate.

Winner: ${winnerName === 'tie' ? 'Tie' : winnerName} (${Math.round(jevFinal.winnerConfidence * 100)}% confidence)
Overall scores: ${scoreList}
Unsupported claim risk: ${riskList}${roundLines ? `\n\nPer-round overall scores:\n${roundLines}` : ''}

You may reference Jev's judgment in your response — agree with it, contest it, or use it to strengthen your argument. Do not treat it as infallible, but do engage with it seriously.
`
  }

  // Fabrication spans — always shown when present, independent of final judgment
  const fabricationLines: string[] = []
  if (jevRounds) {
    for (let i = 0; i < jevRounds.length; i++) {
      const jr = jevRounds[i]
      if (!jr) continue
      const label = i === 0 ? 'Opening Statements' : `Round ${i}`
      for (const p of allProviders) {
        if (p === provider) continue
        const spans = jr.providers[p]?.suspectedFabrication
        if (!spans?.length) continue
        fabricationLines.push(`  ${label} — ${MODEL_NAMES[p] ?? p}: ${spans.map(s => `"${s}"`).join(' | ')}`)
      }
    }
  }

  const fabricationBlock = fabricationLines.length > 0
    ? `\n=== Jev Span Flags (PROTOTYPE — high false-positive rate) ===
The following spans in your competitors' responses were flagged by an experimental claim-precision detector. This detector is known to produce false positives. Do NOT treat these as confirmed fabrications or attack them as such. You may independently assess whether a flagged claim is genuinely unsupported — but only engage if you find real substance to challenge. If a flag looks like noise, ignore it entirely.

${fabricationLines.join('\n')}
`
    : ''

  return `You are ${self}, competing in an LLM Roundtable against ${others.join(' and ')}. Today's date is ${today}. When writing math, use $$ for inline expressions and a fenced \`\`\`math block for display equations — do not use single $, as it conflicts with currency symbols.

The full debate history is below. You can now read everything your competitors have written in all previous rounds. Treat concessions and withdrawals from prior rounds as binding unless the opponent later reverses them. Do not attack a superseded position.
${eliminationNote}
${history}
${fabricationBlock}
${jevBlock}
${taskDirective}`
}
