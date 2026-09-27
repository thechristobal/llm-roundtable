import type { AdapterErrorCategory, AdapterErrorWire, AdapterProvider } from '../../../shared/adapter-errors'

// Result<T, E> — the single seam every client fetch returns through.
// Callers destructure `.ok` and branch: no try/catch, no string sniffing,
// no silent HTTP-status fallback that drops the server's error message.
export type Result<T, E> = { ok: true; data: T } | { ok: false; error: E }

// Coerce anything a fetch/network layer can throw (or an already-parsed
// non-conforming JSON body) into a typed AdapterErrorWire so callers only
// ever handle one error shape.
export function toWireError(
  err: unknown,
  fallbackProvider: AdapterProvider,
  fallbackCategory: AdapterErrorCategory = 'unknown',
): AdapterErrorWire {
  const message = err instanceof Error ? err.message : String(err)
  return {
    category: fallbackCategory,
    provider: fallbackProvider,
    message: message || 'Request failed',
    retryable: false,
  }
}
