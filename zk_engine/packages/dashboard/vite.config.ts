import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  root: 'src/ui',
  build: {
    // fileURLToPath (not .pathname): platform-correct absolute path — the
    // previous `.pathname` produced a POSIX path that broke Windows builds.
    outDir: fileURLToPath(new URL('dist/web', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
  },
});
