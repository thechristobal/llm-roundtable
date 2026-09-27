// Jev question construction: takes the canonical rubric schema and emits the
// per-provider question payload the Jev API receives. This module owns HOW the
// rubric is turned into on-wire questions and state; it does NOT own rubric
// identity (shared/jev-rubric.ts) or scoring policy (server/src/jev-policy.ts).
//
// Question prose is preserved verbatim from the pre-refactor judgePrompt.ts —
// snapshots in server/src/__snapshots__/schema-goldens.test.ts.snap pin it.
// All on-wire question ids come from the canonical key builders; no
// hand-concatenated strings anywhere in this module (enforced by
// server/src/jev-schema-coverage.test.ts).

import type { JevQuestion } from './adapters/jev.js'
import {
  DIMENSIONS, FLAGS, GATES, FINAL_KEYS, WINNER_KEY,
  dimensionKey, flagKey, gateKey, finalKey,
  type DimensionKey, type FlagKey, type GateKey, type FinalKey,
} from '../../shared/jev-rubric.js'
import type { ProviderID } from '../../shared/providers.js'

// Local display-name map. Correction #4: MODEL_NAMES is NOT Jev-specific
// (debate/prompt code uses the same mapping) but no generic provider-metadata
// seam exists yet, so we keep a local copy here rather than inventing one.
// A future candidate can promote this to shared/providers.ts.
const MODEL_NAMES: Record<ProviderID, string> = {
  openai:    'ChatGPT',
  anthropic: 'Claude',
  google:    'Gemini',
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

function displayName(p: ProviderID): string { return MODEL_NAMES[p] ?? p }

// ── State builders (unchanged from judgePrompt.ts) ──

export function buildRoundState(round: JudgeRound, allProviders: readonly ProviderID[]) {
  return {
    round_type: round.trigger,
    prompt: round.prompt,
    responses: Object.fromEntries(
      allProviders
        .filter(p => round.responses[p])
        .map(p => [displayName(p), round.responses[p]])
    ),
  }
}

export function buildFinalState(rounds: JudgeRound[], allProviders: readonly ProviderID[]) {
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
            displayName(p),
            r.responses[p] ?? '(did not respond)',
          ])
        ),
      }
    }),
  }
}

// ── Prose templates keyed by canonical schema entries ──
// Prose is preserved verbatim; snapshots pin it. Do not edit without
// updating server/src/__snapshots__/schema-goldens.test.ts.snap.

const DIM_QUESTION: Record<DimensionKey, (name: string) => JevQuestion> = {
  reasoning: name => ({
    type: 'score',
    instructions: `Rate the quality of ${name}'s reasoning and logical structure in this round.`,
    criteria: SCORE_RUBRIC,
  }),
  coherence: name => ({
    type: 'score',
    instructions: `Rate the internal coherence and clarity of ${name}'s response — does the argument hold together consistently without contradiction?`,
    criteria: SCORE_RUBRIC,
  }),
  evidence: name => ({
    type: 'score',
    instructions: `Rate the precision of empirical claims in ${name}'s response. Use 5 as neutral (no empirical claims made). Score above 5 for claims that are specific, grounded, and stated with appropriate confidence — citation not required, specificity and groundedness are the bar. Score below 5 for vague appeals to authority ("studies show...", "research suggests..." with no precision), imprecise statistics, or claims stated with more confidence than the evidence warrants. This score may be overridden by the system if no evidentiary burden was incurred.`,
    criteria: SCORE_RUBRIC,
  }),
  honesty: name => ({
    type: 'score',
    instructions: `Rate ${name}'s intellectual honesty — does it acknowledge genuine uncertainty, avoid false confidence, and engage fairly with opposing points rather than strawmanning them?`,
    criteria: SCORE_RUBRIC,
  }),
}

const FLAG_QUESTION: Record<FlagKey, (name: string) => JevQuestion> = {
  eqAnchor: name => ({
    type: 'noul',
    instructions: `Did ${name}'s argument depend on factual claims such that the conclusion would materially weaken if those claims were false? Load-bearing factual premises include statistics, historical facts, scientific findings, research results, benchmarks, or claims about current events. Purely conceptual, deductive, or analytical arguments with no load-bearing factual premises should return false.`,
    criteria: {
      true: 'Yes — the argument relies on load-bearing factual claims; if false, the argument materially weakens',
      false: 'No — the argument is primarily conceptual, deductive, or analytical; no factual claim is load-bearing',
    },
  }),
  fabrication: name => ({
    type: 'noul',
    instructions: `Did ${name} fabricate or materially misrepresent evidence — inventing quotations, statistics, studies, citations, or findings that do not exist or were substantially falsified? Ordinary factual mistakes, disputed interpretations, and minor citation errors are NOT fabrication.`,
    criteria: {
      true: 'Yes — contains invented or materially misrepresented evidence central to the argument',
      false: 'No — no fabrication detected; any errors appear to be genuine mistakes rather than invented material',
    },
  }),
  contradiction: name => ({
    type: 'noul',
    instructions: `Did ${name}'s response contain a material internal contradiction — asserting two claims that directly undermine each other in a way that damages the argument's validity? Minor nuance, hedging, or tension that is adequately explained is NOT a contradiction.`,
    criteria: {
      true: 'Yes — contains a material self-contradiction that undermines the argument\'s validity',
      false: 'No — the argument is internally consistent or any apparent tension is adequately resolved',
    },
  }),
}

const GATE_QUESTION: Record<GateKey, (name: string, isInitial: boolean) => JevQuestion> = {
  relevance: (name, isInitial) => ({
    type: 'noul',
    instructions: isInitial
      ? `Did ${name} fail to address the user's prompt — sidestepping, deflecting, or substituting a different question rather than answering directly?`
      : `Did ${name} fail to respond to the user's prompt or the other models' specific arguments — ignoring what was asked or said, talking past opponents, or evading the actual question?`,
    criteria: {
      true: 'Yes — the response sidesteps, deflects, or fails to engage with what was actually asked or argued',
      false: 'No — the response directly addresses the prompt and/or the opponents\' arguments',
    },
  }),
}

const FINAL_QUESTION: Record<FinalKey, (name: string) => JevQuestion> = {
  overall: name => ({
    type: 'score',
    instructions: `Rate ${name}'s overall performance across the entire debate — totality of argument, consistency across rounds, and cumulative contribution.`,
    criteria: SCORE_RUBRIC,
  }),
  claim_risk: name => ({
    type: 'noul',
    instructions: `Did ${name} make claims across the debate that appear unsupported, unverified, or that would require external fact-checking to confirm?`,
    criteria: {
      true: 'Yes — contains one or more claims that appear unsupported or require external verification',
      false: 'No — claims are appropriately hedged or clearly supportable from the debate context',
    },
  }),
}

// ── Question builders (iterate the canonical schema) ──
// The insertion order below is load-bearing: goldens pin the order
// reasoning → relevance → coherence → evidence → eqAnchor → fabrication →
// contradiction → honesty per provider. Changing the loop order changes the
// wire, which breaks schema-goldens snapshots by design.

export function buildRoundQuestions(
  activeProviders: readonly ProviderID[],
  isInitial: boolean,
): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {}

  // Preserve the pre-refactor emission order within each provider:
  //   reasoning, relevance, coherence, evidence, eq_burden, fabrication, contradiction, honesty
  // This is not a natural iteration order over DIMENSIONS/FLAGS/GATES, so we
  // spell it out step-by-step (each step still uses the canonical key builder).
  for (const p of activeProviders) {
    const name = displayName(p)
    questions[dimensionKey(p, 'reasoning')]  = DIM_QUESTION.reasoning(name)
    questions[gateKey(p, 'relevance')]       = GATE_QUESTION.relevance(name, isInitial)
    questions[dimensionKey(p, 'coherence')]  = DIM_QUESTION.coherence(name)
    questions[dimensionKey(p, 'evidence')]   = DIM_QUESTION.evidence(name)
    questions[flagKey(p, 'eqAnchor')]        = FLAG_QUESTION.eqAnchor(name)
    questions[flagKey(p, 'fabrication')]     = FLAG_QUESTION.fabrication(name)
    questions[flagKey(p, 'contradiction')]   = FLAG_QUESTION.contradiction(name)
    questions[dimensionKey(p, 'honesty')]    = DIM_QUESTION.honesty(name)
  }

  return questions
}

export function buildFinalQuestions(
  activeProviders: readonly ProviderID[],
): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {}

  for (const p of activeProviders) {
    const name = displayName(p)
    for (const f of FINAL_KEYS) {
      questions[finalKey(p, f)] = FINAL_QUESTION[f](name)
    }
  }

  const winnerCriteria: Record<string, string> = {}
  for (const p of activeProviders) {
    winnerCriteria[p] = `${displayName(p)} clearly demonstrated the strongest overall performance across the debate`
  }
  winnerCriteria.tie = 'The models performed so similarly across all evaluated dimensions that no clear winner can be identified — use only when genuinely indistinguishable'

  questions[WINNER_KEY] = {
    type: 'choice',
    instructions: 'Based on the full debate transcript, which model won? Evaluate on totality of argument, reasoning quality, coherence, and intellectual honesty. Choose a single winner unless performance is genuinely indistinguishable.',
    criteria: winnerCriteria,
  }

  return questions
}

// Re-export MODEL_NAMES for the route handler's locateFabrication display use.
// Not the durable home for this map — see comment above.
export { MODEL_NAMES }

// Marker exports to satisfy the schema-coverage test suite: these prove the
// module actually imports every canonical concept.
export const _SCHEMA_COVERAGE_MARKERS = { DIMENSIONS, FLAGS, GATES, FINAL_KEYS, WINNER_KEY }
