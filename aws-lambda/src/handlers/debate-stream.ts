import type { APIGatewayProxyEventV2, Context } from 'aws-lambda'
import { Writable } from 'node:stream'
import { extractBearer, verifySession } from '../middleware/auth-jwt.js'
import { CapsViolation, extractSourceIp, validateDebateRequest } from '../middleware/caps.js'
import { logError, logInfo } from '../middleware/log-redact.js'
import { RateLimitExceeded, consumeIpBucket, consumeSessionBucket } from '../middleware/rate-limit.js'
import { DEMO_CAPS } from '../config/demo.js'
import { orchestrate } from '../orchestrator/debate.js'
import { selectOpenAiAuthStrategy } from '../strategies/openai-auth.js'
import type { DemoCredentials, StreamEvent } from '../types.js'

// NDJSON wire format: one JSON StreamEvent per line. Chosen over SSE because
// API Gateway REST + CloudFront strips text/event-stream buffering guarantees
// and the client only needs discrete event framing, not reconnect semantics.
function writeEvent(stream: Writable, evt: StreamEvent | { type: 'error'; message: string; category: string }): void {
  stream.write(JSON.stringify(evt) + '\n')
}

function extractCredentials(headers: Record<string, string | undefined>): DemoCredentials {
  const openai = selectOpenAiAuthStrategy().extractCredential(headers)
  const creds: DemoCredentials = {}
  if (openai) creds.openai = openai
  const anthropic = headers['x-anthropic-key']?.trim()
  if (anthropic) creds.anthropic = anthropic
  const google = headers['x-google-key']?.trim()
  if (google) creds.google = google
  const typesafe = headers['x-typesafe-key']?.trim()
  if (typesafe) creds.typesafe = typesafe
  return creds
}

async function run(event: APIGatewayProxyEventV2, stream: Writable, context: Context): Promise<void> {
  const reqId = context.awsRequestId
  const headers = Object.fromEntries(
    Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v ?? undefined]),
  )
  const sourceIp = extractSourceIp(headers)

  const token = extractBearer(headers['authorization'])
  if (!token) {
    writeEvent(stream, { type: 'error', category: 'auth', message: 'Missing bearer token' })
    stream.end()
    return
  }

  let claims
  try {
    claims = await verifySession(token)
  } catch {
    writeEvent(stream, { type: 'error', category: 'auth', message: 'Invalid or expired session' })
    stream.end()
    return
  }

  try {
    await consumeSessionBucket(claims.jti, DEMO_CAPS.sessionBucketLimitPerHour, 3600)
    await consumeIpBucket(sourceIp, DEMO_CAPS.ipBucketLimitPer24h, 86400)
  } catch (err) {
    if (err instanceof RateLimitExceeded) {
      logInfo({ event: 'rate_limited', reqId, sub: claims.sub, sourceIp, scope: err.scope })
      writeEvent(stream, { type: 'error', category: 'quota', message: `Rate limit exceeded (${err.scope})` })
      stream.end()
      return
    }
    throw err
  }

  let body
  try {
    body = validateDebateRequest(event.body ? JSON.parse(event.body) : undefined)
  } catch (err) {
    if (err instanceof CapsViolation) {
      writeEvent(stream, { type: 'error', category: 'invalid_request', message: err.message })
      stream.end()
      return
    }
    writeEvent(stream, { type: 'error', category: 'invalid_request', message: 'Malformed request body' })
    stream.end()
    return
  }

  const credentials = extractCredentials(headers)
  logInfo({ event: 'debate_start', reqId, sub: claims.sub, sourceIp, action: body.action, roundsCount: body.rounds.length })

  try {
    for await (const evt of orchestrate({ action: body.action, prompt: body.prompt, rounds: body.rounds, credentials })) {
      writeEvent(stream, evt)
    }
    logInfo({ event: 'debate_complete', reqId, sub: claims.sub })
  } catch (err) {
    logError({ event: 'debate_failed', reqId, sub: claims.sub, error: err })
    writeEvent(stream, { type: 'error', category: 'unknown', message: 'Orchestration failed' })
  } finally {
    stream.end()
  }
}

// awslambda.streamifyResponse() is injected by the Lambda runtime at execution
// time, not importable as a module. Node 22+ runtimes expose it on globalThis.
export const handler = awslambda.streamifyResponse(async (event, responseStream, context) => {
  const metadata = { statusCode: 200, headers: { 'content-type': 'application/x-ndjson' } }
  const stream = awslambda.HttpResponseStream.from(responseStream, metadata)
  await run(event as APIGatewayProxyEventV2, stream, context)
})
