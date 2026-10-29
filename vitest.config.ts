import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,mjs}'],
    env: { CORTICO_LANGUAGE: 'zh' },
    testTimeout: 20000,
    pool: 'forks',
  },
});
