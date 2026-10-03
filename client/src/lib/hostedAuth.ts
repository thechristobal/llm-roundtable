// Session + BYO-key storage for the hosted demo.
//
// Bearer and BYO keys live in sessionStorage so they survive page refreshes
// but die with the tab. localStorage would persist them indefinitely —
// unacceptable for a demo that mints short-lived tokens and holds live
// provider credentials.

const BEARER_KEY = 'roundtable_bearer'
const KEYS_KEY = 'roundtable_byo_keys'

export type ByoKeys = {
  openai?: string
  anthropic?: string
  google?: string
}

export function getBearer(): string | null {
  try { return sessionStorage.getItem(BEARER_KEY) } catch { return null }
}

export function setBearer(token: string): void {
  try { sessionStorage.setItem(BEARER_KEY, token) } catch { /* storage disabled; next request will 401 and re-gate */ }
}

export function clearBearer(): void {
  try { sessionStorage.removeItem(BEARER_KEY) } catch { /* no-op */ }
}

export function getByoKeys(): ByoKeys {
  try {
    const raw = sessionStorage.getItem(KEYS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as ByoKeys
  } catch { return {} }
}

export function setByoKeys(keys: ByoKeys): void {
  try { sessionStorage.setItem(KEYS_KEY, JSON.stringify(keys)) } catch { /* no-op */ }
}

export function hasAnyByoKey(keys: ByoKeys): boolean {
  return Boolean(keys.openai || keys.anthropic || keys.google)
}
