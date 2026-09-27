import type { Response } from 'express'
import type { AdapterErrorCategory, AdapterErrorWire, AdapterProvider, ApiErrorResponse } from '../../shared/adapter-errors.js'
import { AdapterError, defaultRetryable, toHttpStatus, toWire } from './adapters/errors.js'

// Single wire seam for every server response. Success payloads pass through
// unchanged; error payloads always ship as { error: AdapterErrorWire } so the
// client's fetch helper can render off category/retryable without string
// sniffing. See http-boundary-goldens.test.ts for the pinned shapes.

interface SendErrorOptions {
  category: AdapterErrorCategory
  provider: AdapterProvider
  message: string
  retryable?: boolean
  retryAfterMs?: number
}

export function sendError(res: Response, opts: SendErrorOptions): void {
  const wire: AdapterErrorWire = {
    category: opts.category,
    provider: opts.provider,
    message: opts.message,
    retryable: opts.retryable ?? defaultRetryable(opts.category, opts.retryAfterMs),
  }
  if (opts.retryAfterMs !== undefined) wire.retryAfterMs = opts.retryAfterMs
  const body: ApiErrorResponse = { error: wire }
  res.status(toHttpStatus(opts.category)).json(body)
}

export function sendSuccess<T>(res: Response, data: T): void {
  res.json(data)
}

// Adapter-thrown errors → wire. Unknown throws fall back to a 500 with the
// provider that was in flight, so the client always sees a typed error.
export function sendAdapterError(res: Response, err: unknown, fallbackProvider: AdapterProvider): void {
  if (err instanceof AdapterError) {
    const wire = toWire(err)
    const body: ApiErrorResponse = { error: wire }
    res.status(toHttpStatus(err.category)).json(body)
    return
  }
  const message = err instanceof Error ? err.message : String(err)
  sendError(res, {
    category: 'unknown',
    provider: fallbackProvider,
    message: message || 'Unknown error',
  })
}
