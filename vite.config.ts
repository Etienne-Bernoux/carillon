import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './',
  server: { port: 5273 },
  preview: { port: 5273 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
