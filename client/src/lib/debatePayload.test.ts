import { describe, expect, test } from 'vitest'
import {
  buildDebateAskPayload,
  buildJevPayload,
  toDebateRounds,
} from './debatePayload'
import type { JevFinalResult, JevRoundResult, PanelState, Round } from '../types'

// Fixture helpers keep the tests focused on the semantics under test, not
// the shape of unrelated fields.
const complete = (content: string): PanelState => ({
  status: 'complete',
  content,
  durationMs: 100,
  model: 'test-model',
})
const loading = (): PanelState => ({ status: 'loading' })
const idle = (): PanelState => ({ status: 'idle' })
const errored = (): PanelState => ({
  status: 'error',
  error: { category: 'unknown', provider: 'openai', message: 'boom', retryable: false },
})

function makeRound(
  trigger: Round['trigger'],
  prompt: string | null,
  panels: Round['panels'],
): Round {
  return { trigger, prompt, panels }
}

describe('toDebateRounds', () => {
  test('empty rounds → empty array', () => {
    expect(toDebateRounds([])).toEqual([])
  })

  test('single initial round, all providers complete', () => {
    const input = [makeRound('initial', 'What is 2+2?', {
      openai: complete('four'),
      anthropic: complete('4'),
      google: complete('4.0'),
    })]
    expect(toDebateRounds(input)).toEqual([{
      trigger: 'initial',
      prompt: 'What is 2+2?',
      responses: { openai: 'four', anthropic: '4', google: '4.0' },
    }])
  })

  test('errored panel maps to null', () => {
    const input = [makeRound('initial', 'q', {
      openai: complete('a'),
      anthropic: errored(),
      google: complete('c'),
    })]
    expect(toDebateRounds(input)[0].responses).toEqual({
      openai: 'a', anthropic: null, google: 'c',
    })
  })

  test('loading panel maps to null', () => {
    const input = [makeRound('initial', 'q', {
      openai: loading(), anthropic: complete('b'), google: complete('c'),
    })]
    expect(toDebateRounds(input)[0].responses.openai).toBeNull()
  })

  test('idle panel maps to null', () => {
    const input = [makeRound('initial', 'q', {
      openai: idle(), anthropic: idle(), google: idle(),
    })]
    expect(toDebateRounds(input)[0].responses).toEqual({
      openai: null, anthropic: null, google: null,
    })
  })

  test('fight and seek_consensus rounds have prompt=null', () => {
    const input = [
      makeRound('fight', null, {
        openai: complete('a'), anthropic: complete('b'), google: complete('c'),
      }),
      makeRound('seek_consensus', null, {
        openai: complete('d'), anthropic: complete('e'), google: complete('f'),
      }),
    ]
    const out = toDebateRounds(input)
    expect(out[0].trigger).toBe('fight')
    expect(out[0].prompt).toBeNull()
    expect(out[1].trigger).toBe('seek_consensus')
    expect(out[1].prompt).toBeNull()
  })

  test('follow_up round carries its prompt string', () => {
    const input = [makeRound('follow_up', 'expand', {
      openai: complete('sure'), anthropic: complete('ok'), google: complete('yes'),
    })]
    expect(toDebateRounds(input)[0]).toEqual({
      trigger: 'follow_up',
      prompt: 'expand',
      responses: { openai: 'sure', anthropic: 'ok', google: 'yes' },
    })
  })

  test('response keys follow PROVIDER_ORDER (openai, anthropic, google) regardless of panels key order', () => {
    const input = [makeRound('initial', 'x', {
      google: complete('g'),
      openai: complete('o'),
      anthropic: complete('a'),
    })]
    expect(Object.keys(toDebateRounds(input)[0].responses)).toEqual([
      'openai', 'anthropic', 'google',
    ])
  })

  test('multi-round history preserves order', () => {
    const input = [
      makeRound('initial', 'q1', {
        openai: complete('a1'), anthropic: complete('b1'), google: complete('c1'),
      }),
      makeRound('follow_up', 'q2', {
        openai: complete('a2'), anthropic: complete('b2'), google: complete('c2'),
      }),
      makeRound('fight', null, {
        openai: complete('a3'), anthropic: complete('b3'), google: complete('c3'),
      }),
    ]
    const out = toDebateRounds(input)
    expect(out.map(r => r.trigger)).toEqual(['initial', 'follow_up', 'fight'])
  })
})

describe('buildJevPayload', () => {
  const emptyJevRounds: JevRoundResult[] = []

  test('final idle → {}', () => {
    expect(buildJevPayload({ status: 'idle' }, emptyJevRounds)).toEqual({})
  })

  test('final loading → {}', () => {
    expect(buildJevPayload({ status: 'loading' }, emptyJevRounds)).toEqual({})
  })

  test('final error → {}', () => {
    expect(buildJevPayload({ status: 'error', message: 'boom' }, emptyJevRounds)).toEqual({})
  })

  test('final complete with no rounds → emits jevFinal + empty jevRounds', () => {
    const finalResult: JevFinalResult = {
      status: 'complete',
      scores: { openai: 8.2, anthropic: 7.5, google: 6.9 },
      claimRisk: { openai: 0.1, anthropic: 0.3, google: 0.05 },
      winner: 'openai',
      winnerConfidence: 0.87,
      mock: false,
    }
    expect(buildJevPayload(finalResult, emptyJevRounds)).toEqual({
      jevFinal: {
        scores: { openai: 8.2, anthropic: 7.5, google: 6.9 },
        claimRisk: { openai: 0.1, anthropic: 0.3, google: 0.05 },
        winner: 'openai',
        winnerConfidence: 0.87,
      },
      jevRounds: [],
    })
    // mock: false in JevFinalResult is deliberately NOT propagated to the payload.
  })

  test('non-complete rounds each map to null in jevRounds', () => {
    const finalResult: JevFinalResult = {
      status: 'complete',
      scores: {}, claimRisk: {}, winner: 'tie', winnerConfidence: 0, mock: false,
    }
    const rounds: JevRoundResult[] = [
      { status: 'idle' },
      { status: 'loading' },
      { status: 'error', message: 'x' },
    ]
    const out = buildJevPayload(finalResult, rounds) as { jevRounds: unknown[] }
    expect(out.jevRounds).toEqual([null, null, null])
  })

  test('complete round maps each provider to { overall, suspectedFabrication } only', () => {
    const finalResult: JevFinalResult = {
      status: 'complete',
      scores: {}, claimRisk: {}, winner: 'tie', winnerConfidence: 0, mock: false,
    }
    const rounds: JevRoundResult[] = [{
      status: 'complete',
      mock: false,
      providers: {
        openai: {
          reasoning: { score: 1, confidence: 1 },
          coherence: { score: 1, confidence: 1 },
          evidence: { score: 1, confidence: 1 },
          honesty: { score: 1, confidence: 1 },
          relevance: { noul: 1, confidence: 1 },
          overall: 8.5,
          eqAnchored: false,
          fabricationDetected: false,
          contradictionDetected: false,
          disqualified: false,
          suspectedFabrication: ['claim a', 'claim b'],
        },
        anthropic: {
          reasoning: { score: 0.5, confidence: 0.9 },
          coherence: { score: 0.7, confidence: 0.9 },
          evidence: { score: 0.6, confidence: 0.9 },
          honesty: { score: 1, confidence: 1 },
          relevance: { noul: 1, confidence: 1 },
          overall: 7.0,
          eqAnchored: true,
          fabricationDetected: false,
          contradictionDetected: false,
          disqualified: false,
          suspectedFabrication: [],
        },
      },
    }]
    const out = buildJevPayload(finalResult, rounds) as {
      jevRounds: { providers: Record<string, { overall: number; suspectedFabrication: string[] }> }[]
    }
    expect(out.jevRounds[0]).toEqual({
      providers: {
        openai: { overall: 8.5, suspectedFabrication: ['claim a', 'claim b'] },
        anthropic: { overall: 7.0, suspectedFabrication: [] },
      },
    })
    // Confirms per-provider payload strips all other fields (reasoning, coherence, etc.).
  })

  test('mixed complete + non-complete rounds keep positional alignment', () => {
    const finalResult: JevFinalResult = {
      status: 'complete',
      scores: {}, claimRisk: {}, winner: 'tie', winnerConfidence: 0, mock: false,
    }
    const rounds: JevRoundResult[] = [
      { status: 'loading' },
      {
        status: 'complete',
        mock: false,
        providers: {
          openai: {
            reasoning: { score: 0, confidence: 0 },
            coherence: { score: 0, confidence: 0 },
            evidence: { score: 0, confidence: 0 },
            honesty: { score: 0, confidence: 0 },
            relevance: { noul: 0, confidence: 0 },
            overall: 5,
            eqAnchored: false,
            fabricationDetected: false,
            contradictionDetected: false,
            disqualified: false,
            suspectedFabrication: [],
          },
        },
      },
      { status: 'error', message: 'x' },
    ]
    const out = buildJevPayload(finalResult, rounds) as { jevRounds: unknown[] }
    expect(out.jevRounds[0]).toBeNull()
    expect(out.jevRounds[1]).toEqual({
      providers: { openai: { overall: 5, suspectedFabrication: [] } },
    })
    expect(out.jevRounds[2]).toBeNull()
  })
})

describe('buildDebateAskPayload', () => {
  const noPriorRounds: Round[] = []
  const jevIdle = {
    final: { status: 'idle' } as JevFinalResult,
    rounds: [] as JevRoundResult[],
  }

  test('handleSubmit continuation shape: follow_up + followUpPrompt + jev (idle)', () => {
    // jev is idle → buildJevPayload returns {} → spread contributes no keys
    const body = buildDebateAskPayload({
      provider: 'openai',
      action: 'follow_up',
      rounds: noPriorRounds,
      followUpPrompt: 'expand more',
      jev: jevIdle,
    })
    expect(body).toEqual({
      provider: 'openai',
      action: 'follow_up',
      rounds: [],
      followUpPrompt: 'expand more',
    })
  })

  test('handleReroll(follow_up) shape: follow_up + followUpPrompt + NO jev field', () => {
    const body = buildDebateAskPayload({
      provider: 'anthropic',
      action: 'follow_up',
      rounds: noPriorRounds,
      followUpPrompt: 'try again',
    })
    expect(body).toEqual({
      provider: 'anthropic',
      action: 'follow_up',
      rounds: [],
      followUpPrompt: 'try again',
    })
    expect(body).not.toHaveProperty('jevFinal')
    expect(body).not.toHaveProperty('jevRounds')
  })

  test('handleDebateAction(fight) shape: fight + jev + NO followUpPrompt', () => {
    const body = buildDebateAskPayload({
      provider: 'google',
      action: 'fight',
      rounds: noPriorRounds,
      jev: jevIdle,
    })
    expect(body).toEqual({
      provider: 'google',
      action: 'fight',
      rounds: [],
    })
    expect(body).not.toHaveProperty('followUpPrompt')
  })

  test('handleDebateAction(seek_consensus) shape', () => {
    const body = buildDebateAskPayload({
      provider: 'openai',
      action: 'seek_consensus',
      rounds: noPriorRounds,
      jev: jevIdle,
    })
    expect(body).toEqual({
      provider: 'openai',
      action: 'seek_consensus',
      rounds: [],
    })
  })

  test('handleReroll(fight) shape: fight + no followUpPrompt + no jev', () => {
    const body = buildDebateAskPayload({
      provider: 'anthropic',
      action: 'fight',
      rounds: noPriorRounds,
    })
    expect(body).toEqual({
      provider: 'anthropic',
      action: 'fight',
      rounds: [],
    })
  })

  test('handleReroll(seek_consensus) shape', () => {
    const body = buildDebateAskPayload({
      provider: 'google',
      action: 'seek_consensus',
      rounds: noPriorRounds,
    })
    expect(body).toEqual({
      provider: 'google',
      action: 'seek_consensus',
      rounds: [],
    })
  })

  test('follow_up without followUpPrompt does not include the key', () => {
    const body = buildDebateAskPayload({
      provider: 'openai',
      action: 'follow_up',
      rounds: noPriorRounds,
    })
    expect(body).not.toHaveProperty('followUpPrompt')
  })

  test('follow_up with explicit null followUpPrompt emits null (preserves inline `body.followUpPrompt = round.prompt` wire shape)', () => {
    // The reroll call site passes round.prompt directly; round.prompt is
    // typed string | null, so a follow_up round with null prompt must
    // serialize followUpPrompt: null over the wire (rather than omitting
    // the key). This path is unreachable in the current UI but the type
    // permits it, so semantics are pinned here.
    const body = buildDebateAskPayload({
      provider: 'openai',
      action: 'follow_up',
      rounds: noPriorRounds,
      followUpPrompt: null,
    })
    expect(body).toHaveProperty('followUpPrompt', null)
  })

  test('non-follow_up action ignores followUpPrompt if passed', () => {
    const body = buildDebateAskPayload({
      provider: 'openai',
      action: 'fight',
      rounds: noPriorRounds,
      followUpPrompt: 'this should be dropped',
    })
    expect(body).not.toHaveProperty('followUpPrompt')
  })

  test('rounds are transformed via toDebateRounds (complete + error + loading)', () => {
    const body = buildDebateAskPayload({
      provider: 'openai',
      action: 'follow_up',
      rounds: [makeRound('initial', 'q', {
        openai: complete('a'), anthropic: errored(), google: loading(),
      })],
      followUpPrompt: 'x',
    })
    expect(body.rounds).toEqual([{
      trigger: 'initial',
      prompt: 'q',
      responses: { openai: 'a', anthropic: null, google: null },
    }])
  })

  test('jev complete: jevFinal and jevRounds spread into body', () => {
    const finalResult: JevFinalResult = {
      status: 'complete',
      scores: { openai: 8 },
      claimRisk: { openai: 0.1 },
      winner: 'openai',
      winnerConfidence: 0.9,
      mock: false,
    }
    const body = buildDebateAskPayload({
      provider: 'openai',
      action: 'follow_up',
      rounds: noPriorRounds,
      followUpPrompt: 'x',
      jev: { final: finalResult, rounds: [] },
    })
    expect(body).toEqual({
      provider: 'openai',
      action: 'follow_up',
      rounds: [],
      followUpPrompt: 'x',
      jevFinal: {
        scores: { openai: 8 },
        claimRisk: { openai: 0.1 },
        winner: 'openai',
        winnerConfidence: 0.9,
      },
      jevRounds: [],
    })
  })
})

describe('reroll boundary cases', () => {
  test('reroll of round 1 uses rounds.slice(0, 1) → only initial round in history', () => {
    const rounds: Round[] = [
      makeRound('initial', 'q', {
        openai: complete('a'), anthropic: complete('b'), google: complete('c'),
      }),
      makeRound('fight', null, {
        openai: complete('d'), anthropic: complete('e'), google: complete('f'),
      }),
    ]
    const priorRounds = rounds.slice(0, 1)
    const body = buildDebateAskPayload({
      provider: 'openai',
      action: 'fight',
      rounds: priorRounds,
    })
    expect((body.rounds as unknown[]).length).toBe(1)
    expect((body.rounds as { trigger: string }[])[0].trigger).toBe('initial')
  })

  test('reroll of a middle follow_up uses all rounds before it', () => {
    const rounds: Round[] = [
      makeRound('initial', 'q0', {
        openai: complete('a'), anthropic: complete('b'), google: complete('c'),
      }),
      makeRound('follow_up', 'q1', {
        openai: complete('d'), anthropic: complete('e'), google: complete('f'),
      }),
      makeRound('follow_up', 'q2', {
        openai: complete('g'), anthropic: complete('h'), google: complete('i'),
      }),
    ]
    // Reroll roundIdx=2 → slice(0,2) → [initial, first follow_up]
    const priorRounds = rounds.slice(0, 2)
    const body = buildDebateAskPayload({
      provider: 'openai',
      action: 'follow_up',
      rounds: priorRounds,
      followUpPrompt: 'q2',
    })
    expect((body.rounds as { trigger: string; prompt: string | null }[]).map(r => r.trigger)).toEqual([
      'initial', 'follow_up',
    ])
  })

  test('reroll intentionally omits jev even when caller has a complete final judgment', () => {
    // Reroll call sites do NOT pass `jev`; the payload contains no jevFinal/jevRounds
    // regardless of what state the caller holds.
    const body = buildDebateAskPayload({
      provider: 'openai',
      action: 'follow_up',
      rounds: [],
      followUpPrompt: 'redo',
    })
    expect(body).not.toHaveProperty('jevFinal')
    expect(body).not.toHaveProperty('jevRounds')
  })
})
