#!/usr/bin/env node
/**
 * CLI production benchmark — measures the end-to-end cost of the `zk` CLI
 * versus direct in-process engine calls, for prove and verify.
 *
 *   node bench/cli-bench.mjs            # full run (defaults)
 *   node bench/cli-bench.mjs --json     # machine-readable results
 *
 * Overhead = (CLI wall time − direct wall time) / direct wall time.
 * The CLI overhead includes process spawn, Node bootstrap, module load,
 * envelope I/O and JSON serialization — everything a real user pays.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const cliBin = join(repo, 'packages', 'cli', 'dist', 'cli.js');
const engineEntry = join(repo, 'packages', 'engine', 'dist', 'index.js');
const artifactNames = [
  'poseidon-preimage_js/poseidon-preimage.wasm',
  'poseidon-preimage.zkey',
  'poseidon-preimage.r1cs',
  'poseidon-preimage.vkey.json',
];
const artifactsExist = artifactNames.every((name) => {
  try {
    readFileSync(join(repo, 'packages', 'circuit-lib', 'build', name));
    return true;
  } catch {
    return false;
  }
});

if (!artifactsExist) {
  console.error('bench: circuit artifacts not built — run `npm run build:circuits -w @zkpe/circuit-lib` first.');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const ITERS = args.has('--iters') ? 8 : 32;
const JSON_OUT = args.has('--json');

function timed(fn) {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

const dir = mkdtempSync(join(tmpdir(), 'zk-bench-'));
const proveScriptFile = join(dir, 'prove.mjs');
const verifyScriptFile = join(dir, 'verify.mjs');

writeFileSync(proveScriptFile, `
  const { Circuit, prove } = await import(${JSON.stringify('file://' + engineEntry)});
  const { readFileSync } = await import('node:fs');
  const inputs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const c = await Circuit.load('poseidon-preimage');
  await prove(c, inputs);
  process.exit(0);
`);

writeFileSync(verifyScriptFile, `
  const { Circuit, verify } = await import(${JSON.stringify('file://' + engineEntry)});
  const { readFileSync } = await import('node:fs');
  const env = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const c = await Circuit.load(env.circuitId);
  const res = await verify(c, env.publicInputs, env.proof);
  if (!res.valid) throw new Error('direct verify rejected');
  process.exit(0);
`);

function runNode(scriptFile, arg) {
  const r = spawnSync(process.execPath, [scriptFile, arg], { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'subprocess failed');
}



function cli(opts) {
  return spawnSync(process.execPath, [cliBin, ...opts], { encoding: 'utf8', timeout: 120_000 });
}


const inputsFile = join(dir, 'inputs.json');
const outFile = join(dir, 'proof.json');
writeFileSync(inputsFile, JSON.stringify({ preimage: ['123456789', '987654321'] }));

// warmup (JIT, artifact loading)
const warm = cli(['prove', 'poseidon-preimage', inputsFile, '--out', outFile]);
if (warm.status !== 0) throw new Error('warmup prove failed: ' + warm.stderr);

const results = { prove: { direct: [], cli: [] }, verify: { direct: [], cli: [] } };

for (let i = 0; i < ITERS; i++) {
  results.prove.direct.push(
    timed(() => runNode(proveScriptFile, inputsFile)),
  );
  results.prove.cli.push(
    timed(() => {
      const r = cli(['prove', 'poseidon-preimage', inputsFile, '--out', outFile]);
      if (r.status !== 0) throw new Error('cli prove failed: ' + r.stderr);
    }),
  );

  results.verify.direct.push(timed(() => runNode(verifyScriptFile, outFile)));
  results.verify.cli.push(
    timed(() => {
      const r = cli(['verify', outFile, '--offline']);
      if (r.status !== 0) throw new Error('cli verify failed: ' + r.stderr);
    }),
  );
}

function stats(pool) {
  const s = [...pool].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { median, mean };
}

function compareRow(label, direct, cliPool) {
  const d = stats(direct);
  const c = stats(cliPool);
  return { label, directMedianMs: d.median, cliMedianMs: c.median, overheadPct: ((c.median - d.median) / d.median) * 100 };
}

const proveRow = compareRow('prove', results.prove.direct, results.prove.cli);
const verifyRow = compareRow('verify', results.verify.direct, results.verify.cli);

if (JSON_OUT) {
  console.log(JSON.stringify({ iters: ITERS, prove: proveRow, verify: verifyRow }, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`CLI overhead benchmark — ${ITERS} iterations`);
  console.log(`${pad('operation', 10)}  ${pad('direct (median ms)', 18)} ${pad('cli (median ms)', 18)} overhead`);
  console.log(`${pad('prove', 10)}  ${pad(proveRow.directMedianMs.toFixed(1), 18)} ${pad(proveRow.cliMedianMs.toFixed(1), 18)} ${proveRow.overheadPct.toFixed(1)}%`);
  console.log(`${pad('verify', 10)}  ${pad(verifyRow.directMedianMs.toFixed(1), 18)} ${pad(verifyRow.cliMedianMs.toFixed(1), 18)} ${verifyRow.overheadPct.toFixed(1)}%`);
  console.log(`\nEnv: node ${process.version}, ${process.platform}`);
}