import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      'tests/trust_boundary.test.ts',
      'src/server/__tests__/ResearchBudget.test.ts',
      'node_modules/**',
    ],
    // The test files are migratable-style scripts that wrap everything in a
    // single describe/test. They use console.log for output.
    reporters: ['default'],
  },
});
