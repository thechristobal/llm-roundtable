// Secret-hygiene invariant per the architecture plan: no provider credential
// appears in any log line. Defense in depth:
//   1) Convention — callers log explicit fields, never dump req.headers or raw errors
//   2) Regex safety net — this module scans every message for known credential
//      patterns and replaces the match with "[REDACTED]"
//   3) Unit test (log-redact.test.ts) proves a known key gets scrubbed

const CREDENTIAL_HEADER_NAMES = [
  'x-openai-key',
  'x-anthropic-key',
  'x-google-key',
  'x-typesafe-key',
  'authorization',
  'cookie',
]

const CREDENTIAL_VALUE_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /sk-proj-[A-Za-z0-9_-]{20,}/g,
  /sk-[A-Za-z0-9]{32,}/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
]

export function redact(input: string): string {
  let out = input
  for (const re of CREDENTIAL_VALUE_PATTERNS) {
    out = out.replace(re, '[REDACTED]')
  }
  return out
}

export function redactHeaders(headers: Record<string, string | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k] = CREDENTIAL_HEADER_NAMES.includes(k.toLowerCase()) ? '[REDACTED]' : v
  }
  return out
}

export interface SafeLogFields {
  reqId?: string
  sub?: string
  event: string
  [k: string]: unknown
}

export function logInfo(fields: SafeLogFields): void {
  const safe: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    safe[k] = typeof v === 'string' ? redact(v) : v
  }
  console.log(JSON.stringify({ level: 'info', ...safe }))
}

export function logError(fields: SafeLogFields & { error?: unknown }): void {
  const safe: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'error') continue
    safe[k] = typeof v === 'string' ? redact(v) : v
  }
  const err = fields.error
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : undefined
  if (message) safe.errorMessage = redact(message)
  console.log(JSON.stringify({ level: 'error', ...safe }))
}
