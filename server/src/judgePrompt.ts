import type { JevQuestion } from './adapters/jev.js'

const MODEL_NAMES: Record<string, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
}

const SCORE_RUBRIC = [
  '1 — Fails entirely',
  '2 — Very poor',
  '3 — Poor',
  '4 — Below average',
  '5 — Average',
  '6 — Above average',
  '7 — Good',
  '8 — Very good',
  '9 — Excellent',
  '10 — Outstanding',
]

export type JudgeRound = {
  trigger: string
  prompt: string | null
  responses: Record<string, string | null>
}

export function buildRoundState(round: JudgeRound, allProviders: string[]) {
  return {
    round_type: round.trigger,
    prompt: round.prompt,
    responses: Object.fromEntries(
      allProviders
        .filter(p => round.responses[p])
        .map(p => [MODEL_NAMES[p] ?? p, round.responses[p]])
    ),
  }
}

export function buildRoundQuestions(activeProviders: string[], isInitial: boolean): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {}

  for (const p of activeProviders) {
    const name = MODEL_NAMES[p] ?? p

    questions[`${p}_reasoning`] = {
      type: 'score',
      instructions: `Rate the quality of ${name}'s reasoning and logical structure in this round.`,
      criteria: SCORE_RUBRIC,
    }

    questions[`${p}_relevance`] = {
      type: 'noul',
      instructions: isInitial
        ? `Did ${name} fail to address the user's prompt — sidestepping, deflecting, or substituting a different question rather than answering directly?`
        : `Did ${name} fail to respond to the user's prompt or the other models' specific arguments — ignoring what was asked or said, talking past opponents, or evading the actual question?`,
      criteria: {
        true: 'Yes — the response sidesteps, deflects, or fails to engage with what was actually asked or argued',
        false: 'No — the response directly addresses the prompt and/or the opponents\' arguments',
      },
    }

    questions[`${p}_coherence`] = {
      type: 'score',
      instructions: `Rate the internal coherence and clarity of ${name}'s response — does the argument hold together consistently without contradiction?`,
      criteria: SCORE_RUBRIC,
    }

    questions[`${p}_evidence`] = {
      type: 'score',
      instructions: `Rate the precision of empirical claims in ${name}'s response. Use 5 as neutral (no empirical claims made). Score above 5 for claims that are specific, grounded, and stated with appropriate confidence — citation not required, specificity and groundedness are the bar. Score below 5 for vague appeals to authority ("studies show...", "research suggests..." with no precision), imprecise statistics, or claims stated with more confidence than the evidence warrants. This score may be overridden by the system if no evidentiary burden was incurred.`,
      criteria: SCORE_RUBRIC,
    }

    questions[`${p}_eq_burden`] = {
      type: 'noul',
      instructions: `Did ${name}'s argument depend on factual claims such that the conclusion would materially weaken if those claims were false? Load-bearing factual premises include statistics, historical facts, scientific findings, research results, benchmarks, or claims about current events. Purely conceptual, deductive, or analytical arguments with no load-bearing factual premises should return false.`,
      criteria: {
        true: 'Yes — the argument relies on load-bearing factual claims; if false, the argument materially weakens',
        false: 'No — the argument is primarily conceptual, deductive, or analytical; no factual claim is load-bearing',
      },
    }

    questions[`${p}_fabrication`] = {
      type: 'noul',
      instructions: `Did ${name} fabricate or materially misrepresent evidence — inventing quotations, statistics, studies, citations, or findings that do not exist or were substantially falsified? Ordinary factual mistakes, disputed interpretations, and minor citation errors are NOT fabrication.`,
      criteria: {
        true: 'Yes — contains invented or materially misrepresented evidence central to the argument',
        false: 'No — no fabrication detected; any errors appear to be genuine mistakes rather than invented material',
      },
    }

    questions[`${p}_contradiction`] = {
      type: 'noul',
      instructions: `Did ${name}'s response contain a material internal contradiction — asserting two claims that directly undermine each other in a way that damages the argument's validity? Minor nuance, hedging, or tension that is adequately explained is NOT a contradiction.`,
      criteria: {
        true: 'Yes — contains a material self-contradiction that undermines the argument\'s validity',
        false: 'No — the argument is internally consistent or any apparent tension is adequately resolved',
      },
    }

    questions[`${p}_honesty`] = {
      type: 'score',
      instructions: `Rate ${name}'s intellectual honesty — does it acknowledge genuine uncertainty, avoid false confidence, and engage fairly with opposing points rather than strawmanning them?`,
      criteria: SCORE_RUBRIC,
    }

  }

  return questions
}

export function buildFinalState(rounds: JudgeRound[], allProviders: string[]) {
  let debateRoundNum = 0
  return {
    debate_topic: rounds[0]?.prompt ?? 'Unknown topic',
    rounds: rounds.map(r => {
      const label = r.trigger === 'initial' ? 'Opening Statements' : `Round ${++debateRoundNum}`
      return {
        label,
        type: r.trigger,
        ...(r.prompt ? { prompt: r.prompt } : {}),
        responses: Object.fromEntries(
          allProviders.map(p => [
            MODEL_NAMES[p] ?? p,
            r.responses[p] ?? '(did not respond)',
          ])
        ),
      }
    }),
  }
}

export function buildFinalQuestions(activeProviders: string[]): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {}

  for (const p of activeProviders) {
    const name = MODEL_NAMES[p] ?? p

    questions[`${p}_overall`] = {
      type: 'score',
      instructions: `Rate ${name}'s overall performance across the entire debate — totality of argument, consistency across rounds, and cumulative contribution.`,
      criteria: SCORE_RUBRIC,
    }

    questions[`${p}_claim_risk`] = {
      type: 'noul',
      instructions: `Did ${name} make claims across the debate that appear unsupported, unverified, or that would require external fact-checking to confirm?`,
      criteria: {
        true: 'Yes — contains one or more claims that appear unsupported or require external verification',
        false: 'No — claims are appropriately hedged or clearly supportable from the debate context',
      },
    }
  }

  const winnerCriteria: Record<string, string> = {}
  for (const p of activeProviders) {
    winnerCriteria[p] = `${MODEL_NAMES[p] ?? p} clearly demonstrated the strongest overall performance across the debate`
  }
  winnerCriteria.tie = 'The models performed so similarly across all evaluated dimensions that no clear winner can be identified — use only when genuinely indistinguishable'

  questions.winner = {
    type: 'choice',
    instructions: 'Based on the full debate transcript, which model won? Evaluate on totality of argument, reasoning quality, coherence, and intellectual honesty. Choose a single winner unless performance is genuinely indistinguishable.',
    criteria: winnerCriteria,
  }

  return questions
}
