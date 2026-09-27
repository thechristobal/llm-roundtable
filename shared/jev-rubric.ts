// Canonical Jev rubric schema — semantic identity, ordering, and display labels
// that cross the client/server boundary. This module owns NO scoring policy
// (weights, thresholds, caps live in server/src/jev-policy.ts) and NO rubric
// prose (question prompts live in server/src/jev-questions.ts).
//
// Correction #1: types are DERIVED from the const arrays, not declared
// separately. The arrays are the single source of truth; the unions are a
// consequence. Adding/removing an entry updates the type automatically.

import type { ProviderID } from './providers.js'

export type Dimension = { readonly key: string; readonly label: string; readonly displayOrder: number }
export type Flag      = { readonly key: string; readonly label: string; readonly displayOrder: number }
export type Gate      = { readonly key: string; readonly label: string; readonly displayOrder: number }

// Display order matches client/src/components/JevRoundScores.tsx rendering:
// reasoning, honesty, evidence (labeled "Precision"), coherence.
export const DIMENSIONS = [
  { key: 'reasoning', label: 'Reasoning',            displayOrder: 0 },
  { key: 'honesty',   label: 'Intellectual Honesty', displayOrder: 1 },
  { key: 'evidence',  label: 'Precision',            displayOrder: 2 },
  { key: 'coherence', label: 'Coherence',            displayOrder: 3 },
] as const satisfies readonly Dimension[]

export const FLAGS = [
  { key: 'eqAnchor',      label: 'EQ Anchor',     displayOrder: 0 },
  { key: 'contradiction', label: 'Contradiction', displayOrder: 1 },
  { key: 'fabrication',   label: 'Fabrication',   displayOrder: 2 },
] as const satisfies readonly Flag[]

export const GATES = [
  { key: 'relevance', label: 'Task Adherence', displayOrder: 0 },
] as const satisfies readonly Gate[]

export const FINAL_KEYS = ['overall', 'claim_risk'] as const

export const WINNER_KEY = 'winner' as const

// Types derived from the const arrays — no separate hand-declared unions.
export type DimensionKey = typeof DIMENSIONS[number]['key']
export type FlagKey      = typeof FLAGS[number]['key']
export type GateKey      = typeof GATES[number]['key']
export type FinalKey     = typeof FINAL_KEYS[number]

// Flag key suffix map — the ONE place where canonical FlagKey drifts from the
// on-wire question id (`eqAnchor` ↔ `eq_burden`). Preserved verbatim from the
// pre-refactor wire; changing this breaks the golden snapshots by design.
const FLAG_KEY_SUFFIX: Record<FlagKey, string> = {
  eqAnchor:      'eq_burden',
  contradiction: 'contradiction',
  fabrication:   'fabrication',
}

// Key builders — the ONLY producers of on-wire question ids. Mocks, question
// emission, and scorecard parsing all call these; no hand-concatenated strings
// anywhere else in the codebase (enforced by server/src/jev-schema-coverage.test.ts).
export function dimensionKey(provider: ProviderID, dim:  DimensionKey): string { return `${provider}_${dim}` }
export function flagKey     (provider: ProviderID, flag: FlagKey):      string { return `${provider}_${FLAG_KEY_SUFFIX[flag]}` }
export function gateKey     (provider: ProviderID, gate: GateKey):      string { return `${provider}_${gate}` }
export function finalKey    (provider: ProviderID, kind: FinalKey):     string { return `${provider}_${kind}` }
