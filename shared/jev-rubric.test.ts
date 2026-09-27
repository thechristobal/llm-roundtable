import { describe, it, expect } from 'vitest'
import {
  DIMENSIONS, FLAGS, GATES, FINAL_KEYS, WINNER_KEY,
  dimensionKey, flagKey, gateKey, finalKey,
  type DimensionKey, type FlagKey, type GateKey, type FinalKey,
} from './jev-rubric.js'
import type { ProviderID } from './providers.js'

// Correction #3: this file is layer-pure. NO imports from server/, NO imports
// from client/. Assertions cover only structural invariants of the canonical
// schema itself. Coverage of how downstream modules (question builders,
// mock adapter) USE the schema lives in server/src/jev-schema-coverage.test.ts.

const ALL_PROVIDERS: readonly ProviderID[] = ['openai', 'anthropic', 'google']

describe('canonical schema — structural invariants', () => {
  describe.each([
    { name: 'DIMENSIONS', items: DIMENSIONS },
    { name: 'FLAGS',      items: FLAGS },
    { name: 'GATES',      items: GATES },
  ])('$name', ({ items }) => {
    it('has no duplicate keys', () => {
      const keys = items.map(i => i.key)
      expect(new Set(keys).size).toBe(keys.length)
    })

    it('has no duplicate labels', () => {
      const labels = items.map(i => i.label)
      expect(new Set(labels).size).toBe(labels.length)
    })

    it('displayOrder is contiguous 0..n-1 (no gaps)', () => {
      const orders = items.map(i => i.displayOrder).sort((a, b) => a - b)
      expect(orders).toEqual(orders.map((_, i) => i))
    })
  })

  it('FINAL_KEYS has no duplicates', () => {
    expect(new Set(FINAL_KEYS).size).toBe(FINAL_KEYS.length)
  })

  it('WINNER_KEY is not one of FINAL_KEYS (avoid collision)', () => {
    expect(FINAL_KEYS).not.toContain(WINNER_KEY as unknown as FinalKey)
  })
})

describe('key builders — collision resistance across full cross-product', () => {
  it('every (provider, concept) pair produces a unique on-wire string', () => {
    const allKeys = new Set<string>()
    for (const p of ALL_PROVIDERS) {
      for (const d of DIMENSIONS) allKeys.add(dimensionKey(p, d.key as DimensionKey))
      for (const f of FLAGS)      allKeys.add(flagKey(p, f.key as FlagKey))
      for (const g of GATES)      allKeys.add(gateKey(p, g.key as GateKey))
      for (const k of FINAL_KEYS) allKeys.add(finalKey(p, k))
    }
    const expectedCount =
      ALL_PROVIDERS.length * (DIMENSIONS.length + FLAGS.length + GATES.length + FINAL_KEYS.length)
    expect(allKeys.size).toBe(expectedCount)
  })

  it('WINNER_KEY does not collide with any generated per-provider key', () => {
    for (const p of ALL_PROVIDERS) {
      for (const d of DIMENSIONS) expect(dimensionKey(p, d.key as DimensionKey)).not.toBe(WINNER_KEY)
      for (const f of FLAGS)      expect(flagKey(p, f.key as FlagKey)).not.toBe(WINNER_KEY)
      for (const g of GATES)      expect(gateKey(p, g.key as GateKey)).not.toBe(WINNER_KEY)
      for (const k of FINAL_KEYS) expect(finalKey(p, k)).not.toBe(WINNER_KEY)
    }
  })
})

describe('key builders — wire compatibility (preserve pre-refactor on-wire strings)', () => {
  // Golden strings — must match server/src/__snapshots__/schema-goldens.test.ts.snap.
  // If these diverge, the wire and the mocks stop agreeing and the whole
  // scoring pipeline breaks silently. Hand-authored so drift is loud.
  it('dimensionKey produces `${provider}_${dim}` for all canonical dims', () => {
    expect(dimensionKey('openai',    'reasoning')).toBe('openai_reasoning')
    expect(dimensionKey('anthropic', 'honesty')).toBe('anthropic_honesty')
    expect(dimensionKey('google',    'evidence')).toBe('google_evidence')
    expect(dimensionKey('openai',    'coherence')).toBe('openai_coherence')
  })

  it('flagKey preserves the pre-refactor eqAnchor→eq_burden mapping', () => {
    // eqAnchor is the ONE canonical flag whose on-wire suffix differs from its
    // canonical name (`eq_burden` reflects the actual question prose about
    // evidentiary burden). Preserved verbatim to keep goldens stable.
    expect(flagKey('openai',    'eqAnchor')).toBe('openai_eq_burden')
    expect(flagKey('anthropic', 'contradiction')).toBe('anthropic_contradiction')
    expect(flagKey('google',    'fabrication')).toBe('google_fabrication')
  })

  it('gateKey and finalKey produce `${provider}_${key}` verbatim', () => {
    expect(gateKey('openai', 'relevance')).toBe('openai_relevance')
    expect(finalKey('anthropic', 'overall')).toBe('anthropic_overall')
    expect(finalKey('google', 'claim_risk')).toBe('google_claim_risk')
  })

  it('WINNER_KEY is the literal string "winner"', () => {
    expect(WINNER_KEY).toBe('winner')
  })
})
