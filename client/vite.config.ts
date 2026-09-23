import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'

const CSP_DEV = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-eval'",
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

const electronCsp: Plugin = {
  name: 'electron-csp',
  transformIndexHtml(_html, ctx) {
    return [{
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: ctx.server ? CSP_DEV : CSP_PROD },
      injectTo: 'head-prepend',
    }]
  },
}

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [tailwindcss(), react(), electronCsp],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
