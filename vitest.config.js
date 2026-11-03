import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.{js,jsx}', 'supabase/functions/**/*.test.ts'],
    setupFiles: ['fake-indexeddb/auto'],
    env: { TZ: 'America/Vancouver' },
  },
});
