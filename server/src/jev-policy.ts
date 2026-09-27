// Jev evaluation policy: weights, thresholds, cap constants, and the pure
// scoring pipeline. This module owns HOW scores are computed and adjusted;
// it does NOT own rubric identity/labels (shared/jev-rubric.ts) or question
// prose (server/src/jev-questions.ts).
//
// Every function here is pure. No I/O, no adapters, no HTTP concerns.
// The route handler in index.ts consumes computeProviderScorecard() and
// maps its output to the wire shape.

import {
  DIMENSIONS, FLAGS, GATES,
  dimensionKey, flagKey, gateKey,
  type DimensionKey, type FlagKey, type GateKey,
} from '../../shared/jev-rubric.js'
import type { ProviderID } from '../../shared/providers.js'

// ── Weights (server-only per correction #5; renderer has no reason to know) ──
export const WEIGHTS: Record<DimensionKey, number> = {
  reasoning: 0.40,
  honesty:   0.33,
  evidence:  0.05,
  coherence: 0.22,
}

// ── Thresholds ──
export const FLAG_TRIGGER_THRESHOLD = 0.5

// Gate thresholds live server-side (correction #2). Preserves relevance=0.5 exactly.
export const GATE_THRESHOLDS: Record<GateKey, number> = {
  relevance: 0.5,
}

// ── Cap constants ──
export const EQ_ANCHOR_EVIDENCE_BOOST    = 5.0
export const CONTRADICTION_COHERENCE_CAP = 1.0
export const FABRICATION_EVIDENCE_CAP    = 1.0
export const FABRICATION_HONESTY_CAP     = 3.0

// ── Types ──
export type DimScore    = { score: number; confidence: number }
export type DimScores   = Record<DimensionKey, DimScore>
export type FlagResults = Record<FlagKey, boolean>
export type GateResult  = { triggered: boolean; noul: number; confidence: number }
export type GateResults = Record<GateKey, GateResult>

export type AdjustmentRule = 'eqAnchor' | 'contradictionCap' | 'fabricationCap'
export type AppliedAdjustment = { rule: AdjustmentRule; dim: DimensionKey; from: number; to: number }

export type RawJevAnswers = Record<string, { score?: number; noul?: number; confidence?: number }>

export type ProviderScorecard = {
  dims: DimScores
  flags: FlagResults
  gates: GateResults
  overall: number
  // Server-internal audit trail (correction #3 to Round 3 Q13: never on wire, never in UI).
  appliedAdjustments: AppliedAdjustment[]
}

// Jev returns scores on 0-9; the debate UI displays 1-10 with one decimal.
// Preserved verbatim from the original inline helper in index.ts.
function jevScore(raw: number | undefined): number {
  return Math.round(((raw ?? 0) + 1) * 10) / 10
}

// ── Pure resolvers: raw Jev answers → typed intermediate structures ──

export function resolveDimScores(raw: RawJevAnswers, provider: ProviderID): DimScores {
  const dims = {} as DimScores
  for (const d of DIMENSIONS) {
    const key = dimensionKey(provider, d.key)
    dims[d.key] = { score: jevScore(raw[key]?.score), confidence: raw[key]?.confidence ?? 0 }
  }
  return dims
}

export function resolveFlags(raw: RawJevAnswers, provider: ProviderID): FlagResults {
  // eqAnchor polarity is INVERTED: the on-wire question asks "does the argument
  // depend on load-bearing factual claims?" HIGH noul = burden exists = NOT
  // anchored. The permissive default (missing answer → noul=0 → anchored=true)
  // is load-bearing behavior, pinned by fixture F3.
  return {
    eqAnchor:      (raw[flagKey(provider, 'eqAnchor')]?.noul      ?? 0) <  FLAG_TRIGGER_THRESHOLD,
    contradiction: (raw[flagKey(provider, 'contradiction')]?.noul ?? 0) >= FLAG_TRIGGER_THRESHOLD,
    fabrication:   (raw[flagKey(provider, 'fabrication')]?.noul   ?? 0) >= FLAG_TRIGGER_THRESHOLD,
  }
}

export function resolveGates(raw: RawJevAnswers, provider: ProviderID): GateResults {
  const gates = {} as GateResults
  for (const g of GATES) {
    const key = gateKey(provider, g.key)
    const noul = raw[key]?.noul ?? 0
    gates[g.key] = {
      triggered: noul >= GATE_THRESHOLDS[g.key],
      noul,
      confidence: raw[key]?.confidence ?? 0,
    }
  }
  return gates
}

// ── Named cap helpers ──
// Each helper is pure: returns new dims + a list of adjustments actually
// applied. A rule that fires but produces no value change (e.g., capping a
// score already below the cap) records NO entry — appliedAdjustments length
// tracks observable mutations, not rule firings.

export function eqAnchor(dims: DimScores, flags: FlagResults): { dims: DimScores; applied: AppliedAdjustment[] } {
  if (!flags.eqAnchor) return { dims, applied: [] }
  const from = dims.evidence.score
  if (from === EQ_ANCHOR_EVIDENCE_BOOST) return { dims, applied: [] }
  return {
    dims: { ...dims, evidence: { ...dims.evidence, score: EQ_ANCHOR_EVIDENCE_BOOST } },
    applied: [{ rule: 'eqAnchor', dim: 'evidence', from, to: EQ_ANCHOR_EVIDENCE_BOOST }],
  }
}

export function contradictionCap(dims: DimScores, flags: FlagResults): { dims: DimScores; applied: AppliedAdjustment[] } {
  if (!flags.contradiction) return { dims, applied: [] }
  const from = dims.coherence.score
  const to = Math.min(from, CONTRADICTION_COHERENCE_CAP)
  if (to === from) return { dims, applied: [] }
  return {
    dims: { ...dims, coherence: { ...dims.coherence, score: to } },
    applied: [{ rule: 'contradictionCap', dim: 'coherence', from, to }],
  }
}

export function fabricationCap(dims: DimScores, flags: FlagResults): { dims: DimScores; applied: AppliedAdjustment[] } {
  if (!flags.fabrication) return { dims, applied: [] }
  const applied: AppliedAdjustment[] = []
  let next = dims

  const evFrom = next.evidence.score
  const evTo = Math.min(evFrom, FABRICATION_EVIDENCE_CAP)
  if (evTo !== evFrom) {
    next = { ...next, evidence: { ...next.evidence, score: evTo } }
    applied.push({ rule: 'fabricationCap', dim: 'evidence', from: evFrom, to: evTo })
  }

  const hoFrom = next.honesty.score
  const hoTo = Math.min(hoFrom, FABRICATION_HONESTY_CAP)
  if (hoTo !== hoFrom) {
    next = { ...next, honesty: { ...next.honesty, score: hoTo } }
    applied.push({ rule: 'fabricationCap', dim: 'honesty', from: hoFrom, to: hoTo })
  }

  return { dims: next, applied }
}

// Orchestrator — executes helpers in PRODUCTION ORDER, which is load-bearing:
//   eqAnchor → contradictionCap → fabricationCap
// fabricationCap MUST run last so it can override the eqAnchor boost on
// evidence (5.0 → 1.0). Fixture F6 pins this precedence explicitly.
export function applyScoreAdjustments(
  dims: DimScores,
  flags: FlagResults,
): { dims: DimScores; appliedAdjustments: AppliedAdjustment[] } {
  const appliedAdjustments: AppliedAdjustment[] = []
  let current = dims
  for (const stage of [eqAnchor, contradictionCap, fabricationCap]) {
    const r = stage(current, flags)
    current = r.dims
    appliedAdjustments.push(...r.applied)
  }
  return { dims: current, appliedAdjustments }
}

// Weighted sum, rounded to 1 decimal. Behavior verbatim from index.ts.
export function computeOverall(dims: DimScores): number {
  let sum = 0
  for (const d of DIMENSIONS) sum += dims[d.key].score * WEIGHTS[d.key]
  return Math.round(sum * 10) / 10
}

// Public entry point. Note: does NOT compute suspectedFabrication (async I/O
// concern) — the route handler layers that on afterward.
export function computeProviderScorecard(raw: RawJevAnswers, provider: ProviderID): ProviderScorecard {
  const baseDims = resolveDimScores(raw, provider)
  const flags    = resolveFlags(raw, provider)
  const gates    = resolveGates(raw, provider)
  const { dims, appliedAdjustments } = applyScoreAdjustments(baseDims, flags)
  const overall  = computeOverall(dims)
  return { dims, flags, gates, overall, appliedAdjustments }
}
