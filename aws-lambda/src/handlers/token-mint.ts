import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { mintSession } from '../middleware/auth-jwt.js'
import { DEMO_CAPS } from '../config/demo.js'
import { extractSourceIp } from '../middleware/caps.js'
import { getSsmSecret } from '../middleware/secrets.js'
import { logError, logInfo } from '../middleware/log-redact.js'

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

interface TurnstileResponse {
  success: boolean
  'error-codes'?: string[]
  action?: string
  hostname?: string
}

async function verifyTurnstile(token: string, remoteIp: string): Promise<TurnstileResponse> {
  const secret = await getSsmSecret(process.env.TURNSTILE_SECRET_PARAM!)
  const form = new URLSearchParams()
  form.set('secret', secret)
  form.set('response', token)
  form.set('remoteip', remoteIp)
  const res = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body: form })
  return await res.json() as TurnstileResponse
}

function badRequest(message: string): APIGatewayProxyResult {
  return {
    statusCode: 400,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ error: { category: 'invalid_request', message } }),
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = Object.fromEntries(
    Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v ?? undefined]),
  )
  const sourceIp = extractSourceIp(headers)

  let body: { turnstileToken?: unknown } = {}
  try {
    body = event.body ? JSON.parse(event.body) as { turnstileToken?: unknown } : {}
  } catch {
    return badRequest('body must be JSON')
  }
  const token = body.turnstileToken
  if (typeof token !== 'string' || token.length === 0) {
    return badRequest('turnstileToken required')
  }

  try {
    const verdict = await verifyTurnstile(token, sourceIp)
    if (!verdict.success) {
      logInfo({ event: 'turnstile_rejected', sourceIp, errorCodes: verdict['error-codes'] })
      return {
        statusCode: 403,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: { category: 'auth', message: 'Turnstile verification failed' } }),
      }
    }
    const jwt = await mintSession(sourceIp, DEMO_CAPS.sessionTtlSeconds)
    logInfo({ event: 'session_minted', sourceIp })
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: jwt, ttlSeconds: DEMO_CAPS.sessionTtlSeconds }),
    }
  } catch (err) {
    logError({ event: 'token_mint_failed', sourceIp, error: err })
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: { category: 'unknown', message: 'Token mint failed' } }),
    }
  }
}
