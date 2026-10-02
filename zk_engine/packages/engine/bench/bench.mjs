#!/usr/bin/env node
/**
 * M1 benchmark harness (doc 11 targets). Runs prove + verify for every
 * certified v1 circuit through the engine API, prints a table, writes
 * machine-readable results to `packages/circuit-lib/build/bench-m1.json`
 * (gitignored build dir), and exits non-zero if any budget is exceeded.
 *
 * Usage: npm run bench -w @zkpe/engine   (requires built artifacts)
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { performance } from 'node:perf_hooks';
import { buildPoseidonReference } from 'circomlibjs';
import { buildDir } from '@zkpe/circuit-lib';
import { Circuit, prove, verify } from '@zkpe/engine';

const BUDGETS_MS = {
  'poseidon-preimage': { proveMs: 3000, verifyMs: 1000 },
  'merkle-inclusion': { proveMs: 5000, verifyMs: 1000 },
};

/** Build a valid merkle-inclusion input set against the JS oracle. */
async function merkleInputs() {
  const p = await buildPoseidonReference();
  const node = (l, r) => BigInt(p.F.toString(p([l, r])));
  const leaves = Array.from({ length: 16 }, (_, i) => node(BigInt(i), 7n));
  const levels = [leaves];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    levels.push(Array.from({ length: prev.length / 2 }, (_, i) => node(prev[2 * i], prev[2 * i + 1])));
  }
  const index = 5;
  const pathBits = [];
  const siblings = [];
  let cur = leaves[index];
  for (let i = 0; i < 4; i++) {
    const pos = index >> i;
    const arr = levels[i];
    const sibling = (pos & 1) === 1 ? arr[pos - 1] : arr[pos + 1];
    pathBits.push(pos & 1);
    siblings.push(sibling.toString());
    cur = (pos & 1) === 1 ? node(sibling, cur) : node(cur, sibling);
  }
  return { root: levels[4][0].toString(), leaf: leaves[index].toString(), siblings, pathBits };
}

async function run() {
  const rows = [];
  let allOk = true;
  for (const [circuitId, budget] of Object.entries(BUDGETS_MS)) {
    const circuit = await Circuit.load(circuitId);
    const inputs = circuitId === 'poseidon-preimage'
      ? { preimage: ['123456789', '987654321'] }
      : await merkleInputs();

    // Warm-up (curve wasm / circomlib init costs excluded from the run).
    await prove(circuit, inputs);

    const t0 = performance.now();
    const { proof, publicSignals } = await prove(circuit, inputs);
    const proveMs = performance.now() - t0;

    const t1 = performance.now();
    const { valid } = await verify(circuit, publicSignals, proof);
    const verifyMs = performance.now() - t1;

    const ok = valid && proveMs <= budget.proveMs && verifyMs <= budget.verifyMs;
    allOk &&= ok;
    rows.push({ circuitId, proveMs: Math.round(proveMs * 10) / 10, verifyMs: Math.round(verifyMs * 10) / 10, valid, withinBudget: ok });
    console.log(
      `${circuitId.padEnd(20)} prove ${String(rows.at(-1).proveMs).padStart(8)}ms  ` +
        `verify ${String(rows.at(-1).verifyMs).padStart(7)}ms  ${ok ? 'OK' : 'OVER BUDGET'}  ` +
        `(budget ${budget.proveMs}/${budget.verifyMs}ms)`,
    );
  }

  const outPath = join(buildDir(), 'bench-m1.json');
  writeFileSync(outPath, JSON.stringify({ engine: 'groth16/bn254', toolchain: 'circom 2.1.9, snarkjs 0.7.6, dev ptau16', rows, at: new Date().toISOString() }, null, 2));
  console.log(`\nresults written to ${outPath}`);
  process.exit(allOk ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
