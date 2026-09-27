import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/src/**/*.test.ts', 'shared/**/*.test.ts', 'client/src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
})
