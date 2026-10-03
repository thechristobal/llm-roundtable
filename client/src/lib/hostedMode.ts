// Hosted demo detection + env-driven config.
//
// Hosted mode is set at build time via `vite build --mode hosted`, which exposes
// `VITE_HOSTED_MODE=true` and `VITE_TURNSTILE_SITEKEY=<key>`. Electron builds
// leave both unset, so isHostedMode() is a cheap compile-time branch for
// Electron and a runtime truthy check for the hosted bundle.
export function isHostedMode(): boolean {
  return import.meta.env.VITE_HOSTED_MODE === 'true'
}

export function turnstileSiteKey(): string {
  const key = import.meta.env.VITE_TURNSTILE_SITEKEY
  if (!key) throw new Error('VITE_TURNSTILE_SITEKEY not configured — hosted build must set it')
  return key
}
