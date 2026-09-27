// Canonical provider identity. Client re-exports this from types/index.ts for
// backward compatibility. Server and shared both consume it directly.
//
// Metadata (display name, accent color) intentionally NOT here — that's a UI
// concern currently owned by client/types/index.ts. A future candidate can
// promote provider metadata to a proper shared seam.

export type ProviderID = 'openai' | 'anthropic' | 'google'
