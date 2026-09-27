import type { DebateAction, JevFinalResult, JevRoundResult, ProviderID, Round } from '../types'

// Client-side payload builders shared by every path that hits /api/debate/ask
// (Fight, Seek Consensus, follow-up, reroll). Extracted verbatim from the
// inline call sites in App.tsx as of C4 — semantics pinned by
// debatePayload.test.ts.
//
//  - toDebateRounds: only 'complete' panels contribute content; loading, idle,
//    and error panels all map to null. The server treats those cases identically.
//  - buildJevPayload: only emits jevFinal/jevRounds when the final judgment is
//    complete; otherwise returns {} so the spread contributes no keys.
//  - buildDebateAskPayload: followUpPrompt ships only when action='follow_up'
//    AND the caller passes it. JEV context ships only when the caller supplies
//    `jev` — reroll paths intentionally omit it (models re-answer from the same
//    debate state, not with fresh judgment context).
//
// Callers own the rounds slice: new-round paths pass every prior round; reroll
// paths pass rounds.slice(0, roundIdx).

const PROVIDER_ORDER: readonly ProviderID[] = ['openai', 'anthropic', 'google']

export type DebateRoundWire = {
  trigger: Round['trigger']
  prompt: string | null
  responses: Record<string, string | null>
}

export function toDebateRound(r: Round): DebateRoundWire {
  return {
    trigger: r.trigger,
    prompt: r.prompt,
    responses: Object.fromEntries(
      PROVIDER_ORDER.map(id => {
        const panel = r.panels[id]
        return [id, panel.status === 'complete' ? panel.content : null]
      })
    ),
  }
}

export function toDebateRounds(rounds: Round[]): DebateRoundWire[] {
  return rounds.map(toDebateRound)
}

export type JevPayload =
  | Record<string, never>
  | {
      jevFinal: {
        scores: Partial<Record<ProviderID, number>>
        claimRisk: Partial<Record<ProviderID, number>>
        winner: string
        winnerConfidence: number
      }
      jevRounds: (
        | { providers: Record<string, { overall: number; suspectedFabrication: string[] }> }
        | null
      )[]
    }

export function buildJevPayload(
  jevFinal: JevFinalResult,
  jevRounds: JevRoundResult[],
): JevPayload {
  if (jevFinal.status !== 'complete') return {}
  return {
    jevFinal: {
      scores: jevFinal.scores,
      claimRisk: jevFinal.claimRisk,
      winner: jevFinal.winner,
      winnerConfidence: jevFinal.winnerConfidence,
    },
    jevRounds: jevRounds.map(r =>
      r.status === 'complete'
        ? {
            providers: Object.fromEntries(
              Object.entries(r.providers).map(([k, v]) => [
                k,
                { overall: v!.overall, suspectedFabrication: v!.suspectedFabrication },
              ]),
            ),
          }
        : null,
    ),
  }
}

export type DebateAskInput = {
  provider: ProviderID
  action: DebateAction
  rounds: Round[]
  // string | null is intentional: the reroll site passes round.prompt directly,
  // which is typed as string | null. Passing explicit null preserves the
  // original inline `body.followUpPrompt = round.prompt` wire shape. Omit the
  // key entirely to skip emitting followUpPrompt.
  followUpPrompt?: string | null
  jev?: { final: JevFinalResult; rounds: JevRoundResult[] }
}

export function buildDebateAskPayload(input: DebateAskInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    provider: input.provider,
    action: input.action,
    rounds: toDebateRounds(input.rounds),
  }
  if (input.action === 'follow_up' && input.followUpPrompt !== undefined) {
    body.followUpPrompt = input.followUpPrompt
  }
  if (input.jev) {
    Object.assign(body, buildJevPayload(input.jev.final, input.jev.rounds))
  }
  return body
}
