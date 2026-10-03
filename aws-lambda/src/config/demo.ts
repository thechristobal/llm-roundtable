// Hosted demo caps. The installed desktop app does NOT load this file —
// it runs the orchestrator through server/src/http.ts with no caps. These
// values are the Q25 table approved in the architecture grilling.

export const DEMO_CAPS = {
  promptMaxChars: 1500,
  historyMaxBytes: 32 * 1024,
  historyMaxRounds: 3,
  maxSubsequentActions: 2,
  providerFanOut: 3,
  perProviderMaxOutputTokens: 1000,
  perProviderResponseByteCap: 50 * 1024,
  orchestrationDeadlineMs: 110_000,
  sessionBucketLimitPerHour: 20,
  ipBucketLimitPer24h: 10,
  sessionTtlSeconds: 60 * 60,
  heartbeatIntervalMs: 10_000,
} as const

export type DemoCaps = typeof DEMO_CAPS

export function loadDemoCaps(): DemoCaps {
  if (process.env.ROUNDTABLE_PROFILE !== 'demo') {
    throw new Error('loadDemoCaps() called outside ROUNDTABLE_PROFILE=demo')
  }
  return DEMO_CAPS
}
