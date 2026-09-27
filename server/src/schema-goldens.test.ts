import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildRoundQuestions, buildFinalQuestions } from './jev-questions.js'
import { queryJev } from './adapters/jev.js'
import type { ProviderID } from '../../shared/providers.js'

// Pre-refactor pins for Candidate 2 (Jev source-of-truth centralization).
// These snapshots capture behavior BEFORE any changes so the refactor can
// verify bit-identical outputs. After Candidate 2 lands, these tests will be
// re-pointed at jev-questions.ts / rewired jev.ts and the same snapshots must
// still match.

const PROVIDERS: readonly ProviderID[] = ['openai', 'anthropic', 'google']

describe('I3/I4 golden — buildRoundQuestions', () => {
  it('initial round, 3 providers — question ids + prose', () => {
    expect(buildRoundQuestions(PROVIDERS, true)).toMatchSnapshot()
  })

  it('follow-up round, 3 providers — question ids + prose', () => {
    expect(buildRoundQuestions(PROVIDERS, false)).toMatchSnapshot()
  })

  it('single-provider round (edge case) — key generation still correct', () => {
    expect(buildRoundQuestions(['openai'] as const, true)).toMatchSnapshot()
  })
})

describe('I3/I4 golden — buildFinalQuestions', () => {
  it('3 providers — question ids + prose + winner criteria', () => {
    expect(buildFinalQuestions(PROVIDERS)).toMatchSnapshot()
  })
})

describe('I9 golden — queryJev mock answers (TYPESAFE_API_KEY unset)', () => {
  const original = process.env.TYPESAFE_API_KEY
  beforeAll(() => { delete process.env.TYPESAFE_API_KEY })
  afterAll(() => { if (original !== undefined) process.env.TYPESAFE_API_KEY = original })

  it('mock answers for round-initial questions across 3 providers', async () => {
    const questions = buildRoundQuestions(PROVIDERS, true)
    const res = await queryJev({ state: {}, model: 'jev-latest', questions })
    expect(res.answers).toMatchSnapshot()
  })

  it('mock answers for round-followup questions across 3 providers', async () => {
    const questions = buildRoundQuestions(PROVIDERS, false)
    const res = await queryJev({ state: {}, model: 'jev-latest', questions })
    expect(res.answers).toMatchSnapshot()
  })

  it('mock answers for final questions across 3 providers', async () => {
    const questions = buildFinalQuestions(PROVIDERS)
    const res = await queryJev({ state: {}, model: 'jev-latest', questions })
    expect(res.answers).toMatchSnapshot()
  })
})
