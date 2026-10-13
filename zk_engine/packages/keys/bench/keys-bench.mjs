#!/usr/bin/env node
/**
 * M2 benchmark: envelope signing + verification (ADR-0009, doc 11 targets).
 *
 * Measures:
 *   1. raw Ed25519 sign / verify throughput (node:crypto, native)
 *   2. envelope-level sign + verify (includes canonical serialization +
 *      keccak proofHash + Ed25519)
 *   3. keyring rotation cost
 *
 * Budgets (conservative; native Ed25519 typically does 50k+ ops/s):
 *   sign ≥ 5,000 ops/s · verify ≥ 5,000 ops/s · envelope sign+verify ≥ 2,000/s
 *
 * Results JSON → packages/keys/build/bench-m2.json (gitignored build dir).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { createEnvelope } from '@zkpe/proof-format';
import { generateKeyPair, toNodeJwk } from '@zkpe/keys';
import { KeyRing } from '@zkpe/keys';
import { signEnvelope, verifyEnvelope } from '@zkpe/keys';

const BUDGETS = { rawSignOpsPerSec: 5000, rawVerifyOpsPerSec: 5000, envelopeOpsPerSec: 2000 };

function opsPerSec(n, ms) {
  return Math.round((n / (ms / 1000)) * 10) / 10;
}

async function run() {
  const kp = generateKeyPair();
  const priv = createPrivateKey({ key: toNodeJwk(kp.privateJwk), format: 'jwk' });
  const pub = createPublicKey({ key: toNodeJwk(kp.publicJwk), format: 'jwk' });
  const data = Buffer.from('M2 benchmark payload — canonical bytes', 'utf8');

  // 1. raw sign
  const N = 20000;
  let t0 = performance.now();
  let sig;
  for (let i = 0; i < N; i++) sig = sign(null, data, priv);
  const rawSignMs = performance.now() - t0;
  const rawSign = opsPerSec(N, rawSignMs);

  // 2. raw verify
  t0 = performance.now();
  for (let i = 0; i < N; i++) verify(null, data, pub, sig);
  const rawVerifyMs = performance.now() - t0;
  const rawVerify = opsPerSec(N, rawVerifyMs);

  // 3. envelope-level
  const ring = KeyRing.create();
  ring.rotate();
  const env = createEnvelope({
    circuitId: 'poseidon-preimage',
    circuitVersion: '1.0.0',
    vkHash: '0x' + 'a'.repeat(64),
    publicInputs: ['123456789', '987654321'],
    proof: {
      pi_a: ['1', '2', '3'],
      pi_b: [['1', '2'], ['3', '4'], ['1', '1']],
      pi_c: ['5', '6', '1'],
    },
  });
  const M = 5000;
  t0 = performance.now();
  for (let i = 0; i < M; i++) {
    const signed = signEnvelope(env, { kind: 'keyring', ring });
    verifyEnvelope(signed, { ring });
  }
  const envelopeMs = performance.now() - t0;
  const envelope = opsPerSec(M, envelopeMs);

  // 4. rotation cost
  t0 = performance.now();
  const R = 200;
  for (let i = 0; i < R; i++) ring.rotate();
  const rotateMs = performance.now() - t0;

  const rows = [
    { metric: 'raw sign (Ed25519)', opsPerSec: rawSign, budget: BUDGETS.rawSignOpsPerSec, ok: rawSign >= BUDGETS.rawSignOpsPerSec },
    { metric: 'raw verify (Ed25519)', opsPerSec: rawVerify, budget: BUDGETS.rawVerifyOpsPerSec, ok: rawVerify >= BUDGETS.rawVerifyOpsPerSec },
    { metric: 'envelope sign+verify (v2)', opsPerSec: envelope, budget: BUDGETS.envelopeOpsPerSec, ok: envelope >= BUDGETS.envelopeOpsPerSec },
  ];
  let allOk = true;
  console.log('M2 key benchmarks (Ed25519, node:crypto)');
  for (const r of rows) {
    allOk &&= r.ok;
    console.log(
      `${r.metric.padEnd(30)} ${String(r.opsPerSec).padStart(10)} ops/s  ` +
        `(budget ${r.budget}) ${r.ok ? 'OK' : 'OVER BUDGET'}`,
    );
  }
  console.log(`keyring rotate: ${Math.round(rotateMs / R * 1000) / 1000} ms/op (${R} ops)`);

  const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'bench-m2.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ algo: 'ed25519', rows, rotateMsPerOp: rotateMs / R, at: new Date().toISOString() }, null, 2));
  console.log(`results written to ${outPath}`);
  process.exit(allOk ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
