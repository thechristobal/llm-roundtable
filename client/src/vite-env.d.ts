/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HOSTED_MODE?: string
  readonly VITE_TURNSTILE_SITEKEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
