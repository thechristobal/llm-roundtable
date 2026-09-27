import type { AdapterErrorCategory, AdapterErrorWire, AdapterProvider } from '../../../shared/adapter-errors'

// Thrown by fetchFromEndpoint / any client fetch helper when the server
// responds with an { error: AdapterErrorWire } envelope. Carries the wire
// through so UI code can render off category/retryable without string sniffing.
export class ApiError extends Error {
  readonly wire: AdapterErrorWire
  constructor(wire: AdapterErrorWire) {
    super(wire.message)
    this.name = 'ApiError'
    this.wire = wire
  }
}

// Best-effort recovery of a wire error from any thrown value. Used in catch
// blocks so panel state always has a structured error, even when the throw
// wasn't an ApiError (network failure, non-JSON body, etc.).
export function toWireError(
  err: unknown,
  fallbackProvider: AdapterProvider,
  fallbackCategory: AdapterErrorCategory = 'unknown',
): AdapterErrorWire {
  if (err instanceof ApiError) return err.wire
  const message = err instanceof Error ? err.message : String(err)
  return {
    category: fallbackCategory,
    provider: fallbackProvider,
    message: message || 'Request failed',
    retryable: false,
  }
}
