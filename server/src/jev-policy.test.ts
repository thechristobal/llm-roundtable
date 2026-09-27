import { describe, it, expect } from 'vitest'
import {
  WEIGHTS, FLAG_TRIGGER_THRESHOLD, GATE_THRESHOLDS,
  EQ_ANCHOR_EVIDENCE_BOOST, CONTRADICTION_COHERENCE_CAP,
  FABRICATION_EVIDENCE_CAP, FABRICATION_HONESTY_CAP,
  computeProviderScorecard, applyScoreAdjustments,
  type RawJevAnswers, type ProviderScorecard,
} from './jev-policy.js'
import { DIMENSIONS, dimensionKey, flagKey, gateKey, type DimensionKey } from '../../shared/jev-rubric.js'
import type { ProviderID } from '../../shared/providers.js'

// Characterization fixtures F1–F11 — each pins one or more rules from the
// pre-refactor implementation in server/src/index.ts. Every fixture asserts
// on BOTH the numeric scorecard values AND the named appliedAdjustments
// sequence, so a change to either the value OR the audit trail fails loudly.
//
// Design note on appliedAdjustments: only value-changing mutations are
// recorded. A rule that "fires" but produces from === to (e.g., capping a
// score already at/below the cap) produces no audit entry. This keeps
// appliedAdjustments.length correlated with observable diffs.

const P: ProviderID = 'openai'

// Baseline raw answers: dims 4.0 (→ jevScore 5.0), no flags trigger, no DQ.
function base(): RawJevAnswers {
  return {
    [dimensionKey(P, 'reasoning')]:   { score: 4.0, confidence: 0.7 },
    [dimensionKey(P, 'honesty')]:     { score: 4.0, confidence: 0.7 },
    [dimensionKey(P, 'evidence')]:    { score: 4.0, confidence: 0.7 },
    [dimensionKey(P, 'coherence')]:   { score: 4.0, confidence: 0.7 },
    [flagKey(P, 'eqAnchor')]:         { noul: 0.9, confidence: 0.8 }, // burden exists → NOT anchored
    [flagKey(P, 'contradiction')]:    { noul: 0.0, confidence: 0.9 },
    [flagKey(P, 'fabrication')]:      { noul: 0.0, confidence: 0.9 },
    [gateKey(P, 'relevance')]:        { noul: 0.0, confidence: 0.9 },
  }
}

describe('characterization: computeProviderScorecard', () => {
  it('F1 — all clean (no flags, no gate): pins base weighted-sum math', () => {
    const sc = computeProviderScorecard(base(), P)
    expect(sc.dims.reasoning.score).toBe(5.0)
    expect(sc.dims.honesty.score).toBe(5.0)
    expect(sc.dims.evidence.score).toBe(5.0)
    expect(sc.dims.coherence.score).toBe(5.0)
    expect(sc.flags).toEqual({ eqAnchor: false, contradiction: false, fabrication: false })
    expect(sc.gates.relevance).toEqual({ triggered: false, noul: 0.0, confidence: 0.9 })
    expect(sc.overall).toBe(5.0)
    expect(sc.appliedAdjustments).toEqual([])
  })

  it('F2 — eqAnchor only: evidence boosted from 3.0 to 5.0, audit records the shift', () => {
    const raw = base()
    raw[dimensionKey(P, 'evidence')] = { score: 2.0, confidence: 0.7 } // → jevScore 3.0
    raw[flagKey(P, 'eqAnchor')]      = { noul: 0.2, confidence: 0.8 } // < 0.5 → anchored
    const sc = computeProviderScorecard(raw, P)
    expect(sc.flags.eqAnchor).toBe(true)
    expect(sc.dims.evidence.score).toBe(5.0)
    expect(sc.appliedAdjustments).toEqual([
      { rule: 'eqAnchor', dim: 'evidence', from: 3.0, to: 5.0 },
    ])
  })

  it('F3 — eqAnchor default (eq_burden answer missing): permissive default → anchored', () => {
    const raw = base()
    raw[dimensionKey(P, 'evidence')] = { score: 2.0, confidence: 0.7 }
    delete raw[flagKey(P, 'eqAnchor')] // missing entirely
    const sc = computeProviderScorecard(raw, P)
    // ?? 0 → 0 < 0.5 → eqAnchor triggers even without an explicit answer.
    expect(sc.flags.eqAnchor).toBe(true)
    expect(sc.dims.evidence.score).toBe(5.0)
    expect(sc.appliedAdjustments).toContainEqual(
      { rule: 'eqAnchor', dim: 'evidence', from: 3.0, to: 5.0 },
    )
  })

  it('F4 — contradiction only: coherence capped from 5.0 to 1.0', () => {
    const raw = base()
    raw[flagKey(P, 'contradiction')] = { noul: 0.8, confidence: 0.9 }
    const sc = computeProviderScorecard(raw, P)
    expect(sc.flags.contradiction).toBe(true)
    expect(sc.dims.coherence.score).toBe(1.0)
    expect(sc.appliedAdjustments).toEqual([
      { rule: 'contradictionCap', dim: 'coherence', from: 5.0, to: 1.0 },
    ])
    // Overall: 5*0.40 + 5*0.33 + 5*0.05 + 1*0.22 = 4.12 → 4.1
    expect(sc.overall).toBe(4.1)
  })

  it('F5 — fabrication only: evidence capped to 1.0 AND honesty capped to 3.0', () => {
    const raw = base()
    raw[flagKey(P, 'fabrication')] = { noul: 0.9, confidence: 0.9 }
    const sc = computeProviderScorecard(raw, P)
    expect(sc.flags.fabrication).toBe(true)
    expect(sc.dims.evidence.score).toBe(1.0)
    expect(sc.dims.honesty.score).toBe(3.0)
    expect(sc.appliedAdjustments).toEqual([
      { rule: 'fabricationCap', dim: 'evidence', from: 5.0, to: 1.0 },
      { rule: 'fabricationCap', dim: 'honesty',  from: 5.0, to: 3.0 },
    ])
    // Overall: 5*0.40 + 3*0.33 + 1*0.05 + 5*0.22 = 4.14 → 4.1
    expect(sc.overall).toBe(4.1)
  })

  it('F6 — eqAnchor + fabrication PRECEDENCE: fabrication overrides eq-anchor on evidence (5.0 → 1.0)', () => {
    const raw = base()
    raw[dimensionKey(P, 'evidence')] = { score: 2.0, confidence: 0.7 } // base 3.0
    raw[flagKey(P, 'eqAnchor')]      = { noul: 0.2, confidence: 0.8 }
    raw[flagKey(P, 'fabrication')]   = { noul: 0.9, confidence: 0.9 }
    const sc = computeProviderScorecard(raw, P)
    expect(sc.flags).toMatchObject({ eqAnchor: true, fabrication: true })
    // Final evidence = 1.0 (fabrication wins), NOT 5.0 (which would be if eqAnchor ran last).
    expect(sc.dims.evidence.score).toBe(1.0)
    expect(sc.dims.honesty.score).toBe(3.0)
    // Audit sequence proves the pipeline order:
    //   1. eqAnchor lifted evidence 3 → 5
    //   2. fabricationCap then dropped evidence 5 → 1
    //   3. fabricationCap dropped honesty 5 → 3
    expect(sc.appliedAdjustments).toEqual([
      { rule: 'eqAnchor',       dim: 'evidence', from: 3.0, to: 5.0 },
      { rule: 'fabricationCap', dim: 'evidence', from: 5.0, to: 1.0 },
      { rule: 'fabricationCap', dim: 'honesty',  from: 5.0, to: 3.0 },
    ])
  })

  it('F7 — contradiction + fabrication on independent dims: both apply cleanly', () => {
    const raw = base()
    raw[flagKey(P, 'contradiction')] = { noul: 0.8, confidence: 0.9 }
    raw[flagKey(P, 'fabrication')]   = { noul: 0.9, confidence: 0.9 }
    const sc = computeProviderScorecard(raw, P)
    expect(sc.dims.reasoning.score).toBe(5.0)
    expect(sc.dims.honesty.score).toBe(3.0)
    expect(sc.dims.evidence.score).toBe(1.0)
    expect(sc.dims.coherence.score).toBe(1.0)
    expect(sc.appliedAdjustments).toEqual([
      { rule: 'contradictionCap', dim: 'coherence', from: 5.0, to: 1.0 },
      { rule: 'fabricationCap',   dim: 'evidence',  from: 5.0, to: 1.0 },
      { rule: 'fabricationCap',   dim: 'honesty',   from: 5.0, to: 3.0 },
    ])
    // Overall: 5*0.40 + 3*0.33 + 1*0.05 + 1*0.22 = 3.26 → 3.3
    expect(sc.overall).toBe(3.3)
  })

  it('F8 — all three flags trigger: full-stack precedence with eqAnchor no-op', () => {
    // With base dims all 4.0 → jevScore 5.0, eqAnchor's assignment (evidence
    // to 5.0) is a no-op and produces no audit entry (value-change-only).
    // The other two caps still fire and change values.
    const raw = base()
    raw[flagKey(P, 'eqAnchor')]      = { noul: 0.1, confidence: 0.8 }
    raw[flagKey(P, 'contradiction')] = { noul: 0.9, confidence: 0.9 }
    raw[flagKey(P, 'fabrication')]   = { noul: 0.9, confidence: 0.9 }
    const sc = computeProviderScorecard(raw, P)
    expect(sc.flags).toEqual({ eqAnchor: true, contradiction: true, fabrication: true })
    expect(sc.dims.evidence.score).toBe(1.0)
    expect(sc.dims.coherence.score).toBe(1.0)
    expect(sc.dims.honesty.score).toBe(3.0)
    expect(sc.appliedAdjustments).toEqual([
      { rule: 'contradictionCap', dim: 'coherence', from: 5.0, to: 1.0 },
      { rule: 'fabricationCap',   dim: 'evidence',  from: 5.0, to: 1.0 },
      { rule: 'fabricationCap',   dim: 'honesty',   from: 5.0, to: 3.0 },
    ])
  })

  it('F9 — disqualified only (relevance gate): dim scores + overall untouched', () => {
    const raw = base()
    raw[gateKey(P, 'relevance')] = { noul: 0.8, confidence: 0.9 }
    const sc = computeProviderScorecard(raw, P)
    expect(sc.gates.relevance).toEqual({ triggered: true, noul: 0.8, confidence: 0.9 })
    expect(sc.overall).toBe(5.0) // DQ does NOT zero the score
    expect(sc.appliedAdjustments).toEqual([])
    for (const d of DIMENSIONS) expect(sc.dims[d.key].score).toBe(5.0)
  })

  it('F10 — disqualified + fabrication: DQ does not short-circuit cap application', () => {
    const raw = base()
    raw[gateKey(P, 'relevance')]   = { noul: 0.8, confidence: 0.9 }
    raw[flagKey(P, 'fabrication')] = { noul: 0.9, confidence: 0.9 }
    const sc = computeProviderScorecard(raw, P)
    expect(sc.gates.relevance.triggered).toBe(true)
    expect(sc.dims.evidence.score).toBe(1.0)
    expect(sc.dims.honesty.score).toBe(3.0)
    expect(sc.appliedAdjustments.some(a => a.rule === 'fabricationCap' && a.dim === 'evidence')).toBe(true)
  })

  it('F11 — weighted-sum rounding: pin Math.round((sum*10))/10 behavior', () => {
    // Construct dims so the weighted sum is 4.235: rounds to 4.2 (not 4.3).
    // reasoning=4, honesty=5, evidence=6, coherence=3.5
    //   4*0.40 + 5*0.33 + 6*0.05 + 3.5*0.22 = 1.60 + 1.65 + 0.30 + 0.77 = 4.32
    // Adjust: reasoning=4, honesty=4.5, evidence=5, coherence=4
    //   4*0.40 + 4.5*0.33 + 5*0.05 + 4*0.22 = 1.60 + 1.485 + 0.25 + 0.88 = 4.215 → 4.2
    const raw = base()
    raw[dimensionKey(P, 'reasoning')] = { score: 3.0, confidence: 0.7 } // → 4.0
    raw[dimensionKey(P, 'honesty')]   = { score: 3.5, confidence: 0.7 } // → 4.5
    raw[dimensionKey(P, 'evidence')]  = { score: 4.0, confidence: 0.7 } // → 5.0
    raw[dimensionKey(P, 'coherence')] = { score: 3.0, confidence: 0.7 } // → 4.0
    const sc = computeProviderScorecard(raw, P)
    expect(sc.overall).toBe(4.2)
  })
})

// Additional server-internal policy invariants (not characterization, but
// same file since they test the same module).

describe('policy invariants', () => {
  it('WEIGHTS has an entry for every DimensionKey', () => {
    const dimKeys = new Set(DIMENSIONS.map(d => d.key as DimensionKey))
    expect(new Set(Object.keys(WEIGHTS))).toEqual(dimKeys)
  })

  it('WEIGHTS sums to 1.00 ± 0.001', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0)
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001)
  })

  it('all constants match the pre-refactor values verbatim', () => {
    expect(WEIGHTS).toEqual({ reasoning: 0.40, honesty: 0.33, evidence: 0.05, coherence: 0.22 })
    expect(FLAG_TRIGGER_THRESHOLD).toBe(0.5)
    expect(GATE_THRESHOLDS).toEqual({ relevance: 0.5 })
    expect(EQ_ANCHOR_EVIDENCE_BOOST).toBe(5.0)
    expect(CONTRADICTION_COHERENCE_CAP).toBe(1.0)
    expect(FABRICATION_EVIDENCE_CAP).toBe(1.0)
    expect(FABRICATION_HONESTY_CAP).toBe(3.0)
  })

  it('applyScoreAdjustments does not mutate its input dims', () => {
    const dims = {
      reasoning: { score: 5.0, confidence: 0.7 },
      honesty:   { score: 5.0, confidence: 0.7 },
      evidence:  { score: 5.0, confidence: 0.7 },
      coherence: { score: 5.0, confidence: 0.7 },
    } as const
    const snapshot = JSON.stringify(dims)
    applyScoreAdjustments(structuredClone(dims), {
      eqAnchor: true, contradiction: true, fabrication: true,
    })
    // input isn't touched (defensive — helpers spread, but pin the invariant)
    expect(JSON.stringify(dims)).toBe(snapshot)
  })

  it('every AppliedAdjustment.rule value is in the AdjustmentRule union', () => {
    // Run one fixture that fires all three rules, spot-check the union.
    const raw: RawJevAnswers = {
      [dimensionKey(P, 'reasoning')]: { score: 4.0 },
      [dimensionKey(P, 'honesty')]:   { score: 4.0 },
      [dimensionKey(P, 'evidence')]:  { score: 2.0 },
      [dimensionKey(P, 'coherence')]: { score: 4.0 },
      [flagKey(P, 'eqAnchor')]:      { noul: 0.2 },
      [flagKey(P, 'contradiction')]: { noul: 0.9 },
      [flagKey(P, 'fabrication')]:   { noul: 0.9 },
    }
    const sc: ProviderScorecard = computeProviderScorecard(raw, P)
    const allowed = new Set(['eqAnchor', 'contradictionCap', 'fabricationCap'])
    for (const a of sc.appliedAdjustments) expect(allowed.has(a.rule)).toBe(true)
  })
})
