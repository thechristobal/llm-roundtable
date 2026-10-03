import { SignJWT, jwtVerify } from 'jose'
import { getSsmSecret } from './secrets.js'
import type { DemoSessionClaims } from '../types.js'

const ISSUER = 'roundtable-demo'
const AUDIENCE = 'roundtable-demo-session'

async function key(): Promise<Uint8Array> {
  const raw = await getSsmSecret(process.env.JWT_SECRET_PARAM!)
  return new TextEncoder().encode(raw)
}

export async function mintSession(subject: string, ttlSeconds: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const jti = crypto.randomUUID()
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(subject)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(await key())
}

export async function verifySession(token: string): Promise<DemoSessionClaims> {
  const { payload } = await jwtVerify(token, await key(), {
    issuer: ISSUER,
    audience: AUDIENCE,
  })
  if (!payload.jti || !payload.sub || payload.iat === undefined || payload.exp === undefined) {
    throw new Error('Session token missing required claims')
  }
  return {
    jti: payload.jti,
    sub: payload.sub,
    iat: payload.iat,
    exp: payload.exp,
  }
}

export function extractBearer(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined
  const parts = authHeader.split(/\s+/)
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') return undefined
  return parts[1]
}
