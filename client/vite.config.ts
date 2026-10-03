import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import type { Plugin } from 'vite'
import { defineConfig, loadEnv } from 'vite'

const CSP_DEV = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* ws://localhost:*",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
].join('; ')

const CSP_PROD = [
  "default-src 'none'",
  "script-src 'self'",
  "connect-src 'self' http://127.0.0.1:*",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
].join('; ')

// Hosted-mode CSP: served from CloudFront, talks to same-origin /api/*, and
// loads the Turnstile widget script from challenges.cloudflare.com (which also
// injects its own iframe for the challenge UI).
const CSP_HOSTED = [
  "default-src 'none'",
  "script-src 'self' https://challenges.cloudflare.com",
  "connect-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
].join('; ')

function cspPlugin(hostedBuild: boolean): Plugin {
  return {
    name: 'csp',
    transformIndexHtml(_html, ctx) {
      const content = ctx.server ? CSP_DEV : hostedBuild ? CSP_HOSTED : CSP_PROD
      return [{
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content },
        injectTo: 'head-prepend',
      }]
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname), '')
  const hostedBuild = env.VITE_HOSTED_MODE === 'true'
  return {
    root: path.resolve(__dirname),
    plugins: [tailwindcss(), react(), cspPlugin(hostedBuild)],
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  }
})
