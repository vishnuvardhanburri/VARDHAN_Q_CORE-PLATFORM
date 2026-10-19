#!/usr/bin/env node
/**
 * Integration Validation (Milestone IV) — engine ↔ contracts E2E.
 *
 * Pipeline under test (docs/17-integration-validation.md):
 *   1. engine: generate a proof (live snarkjs prove, not fixtures)
 *   2. engine: verify it locally (offline verifier)
 *   3. registry: register the proof (registerProof) on anvil
 *   4. registry: query getProofStatus
 *   5. gatekeeper: GatedApp.claim before / after / duplicate
 *   7. benchmarks: prove → verify → deploy → register → query → claim
 *
 * Usage: node contracts/integration/run.mjs   (anvil must not be running)
 *
 * Exits 0 iff every step passes under its budget; writes bench.json.
 */

import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const REPO = '/Users/vishnuvardhanburri/zk-proof-engine';
const CONTRACTS = join(REPO, 'contracts');
const ENGINE = require(join(REPO, 'packages', 'engine', 'dist', 'index.js'));
const { publicInputHash } = require('@zkpe/proof-format');

const ANVIL_PORT = process.env.ANVIL_PORT || '8547';
const RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const ANVIL_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const SENDER = exec('cast', ['wallet', 'address', '--private-key', ANVIL_PK]).trim().toLowerCase();
const RECIPIENT = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

let anvilProc = null;
const bench = {};

function assert(cond, msg) {
  if (!cond) throw new Error(`IV FAIL: ${msg}`);
  console.log(`  ok: ${msg}`);
}

async function time(fn) {
  const t0 = performance.now();
  const result = await fn();
  return { ms: performance.now() - t0, result };
}

function exec(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...opts });
}

function cast(...args) {
  return exec('cast', args);
}

function forgeS(...args) {
  return exec('forge', args, { cwd: CONTRACTS, env: { ...process.env, SMOKE_REGISTER: '0' } });
}

async function startAnvil() {
  console.log(`[IV] anvil on :${ANVIL_PORT}`);
  anvilProc = spawn('anvil', ['--port', ANVIL_PORT, '--silent', '--accounts', '10'], { stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 40; i++) {
    try {
      cast('block-number', '--rpc-url', RPC);
      up = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert(up, 'anvil reachable');
}

function deployStack() {
  const out = forgeS(
    'script', 'script/Deploy.s.sol', '--rpc-url', RPC,
    '--broadcast', '--sender', SENDER, '--private-key', ANVIL_PK.slice(2),
  );
  const m = out.match(/ZKVerifierRegistry \(proxy\):\s+(0x[a-f0-9]{40})/i);
  assert(m, 'proxy address parsed from deploy logs');
  return m[1].toLowerCase();
}

function deployGated(proxy) {
  const out = forgeS(
    'script', 'script/DeployGated.s.sol', '--sig', 'run(address)', proxy,
    '--rpc-url', RPC, '--broadcast', '--sender', SENDER, '--private-key', ANVIL_PK.slice(2),
  );
  const m = out.match(/GatedApp\s+(0x[a-f0-9]{40})/i);
  assert(m, 'GatedApp address parsed');
  return m[1].toLowerCase();
}

const toHexField = (v) => `0x${BigInt(v).toString(16).padStart(64, '0')}`;

async function main() {
  await startAnvil();
  try {
    // ---- step 1: prove (live engine) ----
    console.log('[IV] step 1: prove with the engine (preimage 31337,1234567)');
    const { ms: proveMs, result: proved } = await time(async () => {
      const circuit = await ENGINE.Circuit.load('poseidon-preimage');
      return {
        circuit,
        ...(await ENGINE.prove(circuit, { preimage: ['31337', '1234567'] })),
      };
    });
    bench.proveMs = Math.round(proveMs);
    assert(proved.proof && proved.publicSignals.length === 1, `proof + 1 public signal (${Math.round(proveMs)}ms)`);

    // ---- step 2: local verify ----
    console.log('[IV] step 2: verify locally');
    const { ms: verifyMs } = await time(async () => {
      const res = await ENGINE.verify(proved.circuit, proved.publicSignals, proved.proof);
      assert(res.valid, 'engine rejects its own proof');
    });
    bench.verifyMs = Math.round(verifyMs);
    assert(verifyMs < 5000, `local verify ok (${verifyMs}ms)`);

    // ---- build live-proof fixture (normalized b-order, real vkHash) ----
    const realVk = JSON.parse(readFileSync(join(CONTRACTS, 'test', 'fixtures', 'proofs.json'), 'utf8'))
      .circuits[0].vkHash;
    const circuitIdHex =
      '0x' + Buffer.from('poseidon-preimage').toString('hex').padEnd(64, '0');
    const fixture = {
      circuits: [
        {
          circuitId: 'poseidon-preimage',
          circuitIdHex,
          vkHash: realVk,
          a: [proved.proof.pi_a[0], proved.proof.pi_a[1]].map(toHexField),
          b: [proved.proof.pi_b[0][1], proved.proof.pi_b[0][0], proved.proof.pi_b[1][1], proved.proof.pi_b[1][0]].map(toHexField),
          c: [proved.proof.pi_c[0], proved.proof.pi_c[1]].map(toHexField),
          publicInputs: proved.publicSignals.map(toHexField),
        },
      ],
      note: 'generated live by integration/run.mjs',
    };
    const outFile = join(CONTRACTS, 'test', 'fixtures', 'proofs-iv.json');
    writeFileSync(outFile, JSON.stringify(fixture, null, 2));
    console.log(`[IV] live proof -> ${outFile}`);

    // ---- step 3: deploy stack + register ----
    console.log('[IV] step 3: deploy stack, register proof');
    const { ms: deployMs, result: proxy } = await time(() => Promise.resolve(deployStack()));
    bench.deployMs = Math.round(deployMs);

    const { ms: registerMs } = await time(() => {
      forgeS(
        'script', 'script/Register.s.sol', '--sig', 'run(address,string,uint256)', proxy,
        'test/fixtures/proofs-iv.json', '0', '--rpc-url', RPC, '--broadcast',
        '--sender', SENDER, '--private-key', ANVIL_PK,
      );
    });
    bench.registerMs = Math.round(registerMs);
    assert(registerMs < 15000, `register tx ok (${registerMs}ms)`);

    // ---- step 4: query ----
    const inputHash = publicInputHash(fixture.circuits[0].publicInputs.map((h) => BigInt(h).toString()));
    console.log(`[IV] publicInputHash = ${inputHash}`);
    const { ms: queryMs, result: statusOut } = await time(() =>
      cast('call', proxy, 'getProofStatus(bytes32,bytes32)(uint8,uint256)', circuitIdHex, inputHash, '--rpc-url', RPC),
    );
    bench.queryMs = Math.round(queryMs);
    const status = statusOut.trim().split(/\s+/)[0];
    assert(status === '1', `query status Proved(1) (got ${statusOut.trim()})`);

    // ---- step 5: gatekeeper flow ----
    console.log('[IV] step 5: gatekeeper (GatedApp.claim)');
    const { ms: gatedMs, result: gated } = await time(() => Promise.resolve(deployGated(proxy)));
    bench.gatedMs = Math.round(gatedMs);

    const claimSig = 'claim(bytes32,address)';
    let preFailed = false;
    try {
      cast('send', gated, claimSig, '0x' + 'ab'.repeat(32), RECIPIENT, '--rpc-url', RPC, '--private-key', ANVIL_PK);
    } catch (e) {
      preFailed = /revert|Revert/i.test(String(e.stderr || e));
    }
    assert(preFailed, 'unregistered anchor rejected');

    const { ms: claimMs } = await time(() =>
      cast('send', gated, claimSig, inputHash, RECIPIENT, '--rpc-url', RPC, '--private-key', ANVIL_PK),
    );
    bench.claimMs = Math.round(claimMs);
    assert(claimMs < 8000, `claim ok (${claimMs}ms)`);

    let dupFailed = false;
    try {
      cast('send', gated, claimSig, inputHash, RECIPIENT, '--rpc-url', RPC, '--private-key', ANVIL_PK);
    } catch (e) {
      dupFailed = /revert/i.test(String(e.stderr));
    }
    assert(dupFailed, 'duplicate claim rejected');

    // ---- step 7: report ----
    console.log('\n[IV] pipeline (ms): ' + JSON.stringify(bench));
    mkdirSync(join(CONTRACTS, 'integration'), { recursive: true });
    writeFileSync(join(CONTRACTS, 'integration', 'bench.json'), JSON.stringify({ ...bench, at: new Date().toISOString() }, null, 2));
    console.log('[IV] ALL INTEGRATION STEPS PASSED');
  } finally {
    if (anvilProc) anvilProc.kill('SIGTERM');
  }
}

main().catch((e) => {
  console.error(e);
  if (anvilProc) anvilProc.kill('SIGTERM');
  process.exit(1);
});