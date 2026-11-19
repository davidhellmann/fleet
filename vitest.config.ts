import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./dashboard/src', import.meta.url)) } },
  test: {
    include: ['dashboard/src/**/*.test.ts', 'dashboard/collect/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
