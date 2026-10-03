import { DEMO_CAPS } from '../config/demo.js'
import type { DebateRequestBody, DebateRound } from '../types.js'

export class CapsViolation extends Error {
  constructor(public readonly field: string, message: string) {
    super(message)
    this.name = 'CapsViolation'
  }
}

export function validateDebateRequest(body: unknown): DebateRequestBody {
  if (!body || typeof body !== 'object') {
    throw new CapsViolation('body', 'Request body must be an object')
  }
  const b = body as Record<string, unknown>

  const action = b.action
  if (action !== 'opening' && action !== 'fight' && action !== 'seek_consensus' && action !== 'follow_up') {
    throw new CapsViolation('action', `Invalid action: ${String(action)}`)
  }

  const prompt = b.prompt
  if (typeof prompt !== 'string') {
    throw new CapsViolation('prompt', 'prompt must be a string')
  }
  if (prompt.length > DEMO_CAPS.promptMaxChars) {
    throw new CapsViolation('prompt', `prompt exceeds ${DEMO_CAPS.promptMaxChars} chars`)
  }

  const rounds = b.rounds
  if (!Array.isArray(rounds)) {
    throw new CapsViolation('rounds', 'rounds must be an array')
  }
  if (rounds.length > DEMO_CAPS.historyMaxRounds) {
    throw new CapsViolation('rounds', `rounds exceeds ${DEMO_CAPS.historyMaxRounds}`)
  }

  const subsequent = rounds.filter(r => (r as DebateRound).trigger !== 'initial').length
  if (subsequent > DEMO_CAPS.maxSubsequentActions) {
    throw new CapsViolation('rounds', `only ${DEMO_CAPS.maxSubsequentActions} subsequent actions allowed`)
  }

  const serialized = JSON.stringify(rounds)
  if (Buffer.byteLength(serialized, 'utf8') > DEMO_CAPS.historyMaxBytes) {
    throw new CapsViolation('rounds', `serialized rounds exceed ${DEMO_CAPS.historyMaxBytes} bytes`)
  }

  return { action, prompt, rounds: rounds as DebateRound[] }
}

export function extractSourceIp(headers: Record<string, string | undefined>): string {
  // CloudFront-Viewer-Address format: "IPv4:port" or "[IPv6]:port".
  const cfViewer = headers['cloudfront-viewer-address']
  if (cfViewer) {
    const bracketed = /^\[([0-9a-fA-F:]+)\]/.exec(cfViewer)
    if (bracketed && bracketed[1]) return bracketed[1]
    const ipv4 = cfViewer.split(':')[0]?.trim()
    if (ipv4) return ipv4
  }
  const xff = headers['x-forwarded-for']
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return 'unknown'
}
