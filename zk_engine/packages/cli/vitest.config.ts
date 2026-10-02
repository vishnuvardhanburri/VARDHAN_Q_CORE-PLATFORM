import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // production-validation spawns the real `zk` bin; the first cold spawn
    // loads the engine (snarkjs) and can exceed the 5s default on CI
    // runners. 30s is generous for a node spawn without masking hangs
    // (spawnSync enforces its own 90s child timeout inside the test).
    testTimeout: 30_000,
  },
});
