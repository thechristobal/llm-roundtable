import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  DIMENSIONS, FLAGS, GATES, FINAL_KEYS, WINNER_KEY,
  dimensionKey, flagKey, gateKey, finalKey,
  type DimensionKey,
} from '../../shared/jev-rubric.js'
import { buildRoundQuestions, buildFinalQuestions } from './jev-questions.js'
import { queryJev } from './adapters/jev.js'
import type { ProviderID } from '../../shared/providers.js'

// Correction #3: this file is the server-side counterpart to
// shared/jev-rubric.test.ts. It exercises HOW the canonical schema flows into
// downstream modules (question builders, mock adapter, source code), keeping
// the shared test file layer-pure.

const PROVIDERS: readonly ProviderID[] = ['openai', 'anthropic', 'google']

describe('buildRoundQuestions — schema coverage', () => {
  const questions = buildRoundQuestions(PROVIDERS, true)

  it('emits a dimension question for every (provider, dim) pair', () => {
    for (const p of PROVIDERS) {
      for (const d of DIMENSIONS) {
        expect(questions[dimensionKey(p, d.key)]).toBeDefined()
      }
    }
  })

  it('emits a flag question for every (provider, flag) pair', () => {
    for (const p of PROVIDERS) {
      for (const f of FLAGS) {
        expect(questions[flagKey(p, f.key)]).toBeDefined()
      }
    }
  })

  it('emits a gate question for every (provider, gate) pair', () => {
    for (const p of PROVIDERS) {
      for (const g of GATES) {
        expect(questions[gateKey(p, g.key)]).toBeDefined()
      }
    }
  })

  it('emits exactly (dims + flags + gates) × providers keys — no extras, no gaps', () => {
    const expectedCount = PROVIDERS.length * (DIMENSIONS.length + FLAGS.length + GATES.length)
    expect(Object.keys(questions).length).toBe(expectedCount)
  })

  it('emits no keys tied to any canonical id absent from the schema', () => {
    // Every key must be reproducible by one of the four builders — otherwise
    // the wire contains a concept the schema does not know about.
    const expected = new Set<string>()
    for (const p of PROVIDERS) {
      for (const d of DIMENSIONS) expected.add(dimensionKey(p, d.key))
      for (const f of FLAGS)      expected.add(flagKey(p, f.key))
      for (const g of GATES)      expected.add(gateKey(p, g.key))
    }
    for (const k of Object.keys(questions)) expect(expected.has(k)).toBe(true)
  })
})

describe('buildFinalQuestions — schema coverage', () => {
  const questions = buildFinalQuestions(PROVIDERS)

  it('emits a final question for every (provider, finalKey) pair', () => {
    for (const p of PROVIDERS) {
      for (const k of FINAL_KEYS) {
        expect(questions[finalKey(p, k)]).toBeDefined()
      }
    }
  })

  it('emits the winner question exactly once', () => {
    expect(questions[WINNER_KEY]).toBeDefined()
    expect(questions[WINNER_KEY].type).toBe('choice')
  })

  it('winner criteria covers every active provider + tie', () => {
    const w = questions[WINNER_KEY]
    if (w.type !== 'choice') throw new Error('winner should be choice type')
    for (const p of PROVIDERS) expect(w.criteria[p]).toBeDefined()
    expect(w.criteria.tie).toBeDefined()
  })

  it('emits exactly finalKeys × providers + 1 (winner) keys', () => {
    const expectedCount = PROVIDERS.length * FINAL_KEYS.length + 1
    expect(Object.keys(questions).length).toBe(expectedCount)
  })
})

describe('MOCK_SCORES — canonical dimension coverage', () => {
  const originalKey = process.env.TYPESAFE_API_KEY
  beforeAll(() => { delete process.env.TYPESAFE_API_KEY })
  afterAll(() => { if (originalKey !== undefined) process.env.TYPESAFE_API_KEY = originalKey })

  it('mock adapter returns a score for every (provider, canonical dim) pair', async () => {
    const questions = buildRoundQuestions(PROVIDERS, true)
    const res = await queryJev({ state: {}, model: 'jev-latest', questions })
    for (const p of PROVIDERS) {
      for (const d of DIMENSIONS) {
        const key = dimensionKey(p, d.key as DimensionKey)
        const answer = res.answers[key]
        expect(answer).toBeDefined()
        expect(answer.type).toBe('score')
        expect(typeof answer.score).toBe('number')
      }
    }
  })

  it('mock adapter returns an overall score for every provider in final questions', async () => {
    const questions = buildFinalQuestions(PROVIDERS)
    const res = await queryJev({ state: {}, model: 'jev-latest', questions })
    for (const p of PROVIDERS) {
      const answer = res.answers[finalKey(p, 'overall')]
      expect(answer).toBeDefined()
      expect(answer.type).toBe('score')
      expect(typeof answer.score).toBe('number')
    }
  })
})

// ── Static analysis: enforce that on-wire keys are ONLY produced by the
// canonical key builders. Any hand-concatenated string like `${p}_reasoning`
// or 'openai_eq_burden' outside the builder module itself is a drift risk.

describe('no hand-concatenated Jev keys in server source', () => {
  const SERVER_SRC = join(__dirname)
  // Files where hand-concatenated Jev keys are expected/allowed:
  //  - shared/jev-rubric.ts is where the builders live (obviously)
  //  - test fixtures in this file and characterization suites can and must
  //    write literal wire keys to assert the wire shape
  const ALLOW = new Set<string>([
    join(SERVER_SRC, 'jev-schema-coverage.test.ts'),
    join(SERVER_SRC, 'jev-policy.test.ts'),
    join(SERVER_SRC, 'schema-goldens.test.ts'),
    join(SERVER_SRC, 'routes-goldens.test.ts'),
  ])

  // The specific literal fragments we don't want appearing hand-written in
  // non-test source files. Each corresponds to a Jev concept whose on-wire id
  // MUST be produced through the canonical key builder.
  const FORBIDDEN_LITERALS = [
    '_reasoning',
    '_coherence',
    '_evidence',
    '_honesty',
    '_relevance',
    '_eq_burden',
    '_fabrication',
    '_contradiction',
    '_claim_risk',
    // '_overall' is intentionally NOT in this list: `${p}_overall` appears
    // inside the mock adapter's OLD suffix-parse code that Candidate 2 is
    // rewriting. Once the rewire lands, add '_overall' to catch drift.
  ]

  function walk(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      const s = statSync(p)
      if (s.isDirectory()) {
        if (entry === '__snapshots__' || entry === 'node_modules') continue
        out.push(...walk(p))
      } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
        out.push(p)
      }
    }
    return out
  }

  it('production server files do not embed Jev wire suffixes as string literals', () => {
    const files = walk(SERVER_SRC).filter(f => !ALLOW.has(f))
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const lit of FORBIDDEN_LITERALS) {
        // Match the literal only when it appears inside a string context; a
        // rough approximation: the literal shows up preceded by ` or ' or ".
        const pattern = new RegExp(`['"\`][^'"\`\\n]*${lit.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`, 'g')
        if (pattern.test(src)) offenders.push(`${f} → ${lit}`)
      }
    }
    // If this fails, replace the string literal with a call to the canonical
    // key builder (dimensionKey / flagKey / gateKey / finalKey).
    expect(offenders).toEqual([])
  })
})
