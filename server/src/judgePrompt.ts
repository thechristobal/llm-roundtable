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

    questions[`${p}_rebuttal`] = {
      type: 'score',
      instructions: isInitial
        ? `Rate how well ${name} engaged with the original prompt — depth, relevance, and directness of response.`
        : `Rate how well ${name} responded to and engaged with the other models' specific arguments in this round.`,
      criteria: SCORE_RUBRIC,
    }

    questions[`${p}_coherence`] = {
      type: 'score',
      instructions: `Rate the internal coherence and clarity of ${name}'s response — does the argument hold together consistently without contradiction?`,
      criteria: SCORE_RUBRIC,
    }

    questions[`${p}_evidence`] = {
      type: 'score',
      instructions: `Rate ${name}'s evidence discipline — does it make claims proportionate to what it can actually support, avoiding overclaiming or unsupported assertions?`,
      criteria: SCORE_RUBRIC,
    }

    questions[`${p}_honesty`] = {
      type: 'score',
      instructions: `Rate ${name}'s intellectual honesty — does it acknowledge genuine uncertainty, avoid false confidence, and engage fairly with opposing points rather than strawmanning them?`,
      criteria: SCORE_RUBRIC,
    }

    questions[`${p}_spirit`] = {
      type: 'score',
      instructions: `Rate ${name}'s spirit of the debate — did it contribute substantively, engage constructively with others, and advance the discussion rather than talking past competitors?`,
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
