#!/usr/bin/env node
/**
 * Gatekeeper CI fixture — produces a signed proof envelope that the
 * zk-verify gate is expected to accept, or fails loudly if the pipeline
 * regressed. Writes:
 *
 *   .gitgate/gate-envelope.json   envelope (signed, complete with proof)
 *   .gitgate/gate-key.pub.jwk     the signing public key for the gate
 *
 * Production deployments pin the public key out-of-band (GitHub secret or
 * a key service); this fixture is only for the dev loop and CI demo.
 */

/* global process */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, toNodeJwk, signEnvelope } from '@zkpe/keys';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const cliBin = join(repo, 'packages', 'cli', 'dist', 'cli.js');
const outDir = join(repo, '.gitgate');
const envelopeOut = join(outDir, 'gate-envelope.json');
const keyOut = join(outDir, 'gate-key.pub.jwk');

const tmp = join(process.env.RUNNER_TEMP ?? join(repo, '.gitgate', 'tmp'), 'gate-fixture');

function run(args) {
  const r = spawnSync(process.execPath, [cliBin, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    process.stderr.write(r.stderr || r.stdout || `failed: ${args.join(' ')}\n`);
    process.exit(1);
  }
  return r.stdout;
}

async function main() {
  if (!existsSync(cliBin)) {
    process.stderr.write('missing dist/cli.js — run npm run build first\n');
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  const inputs = join(tmp, 'inputs.json');
  const proof = join(tmp, 'proof.json');
  run(['new', 'poseidon-preimage', tmp]);
  run(['prove', 'poseidon-preimage', inputs, '--out', proof]);

  const kp = generateKeyPair();
  const pubJwk = toNodeJwk(kp.publicJwk);
  const envelope = JSON.parse(readFileSync(proof, 'utf8'));
  const signed = signEnvelope(envelope, { privateJwk: toNodeJwk(kp.privateJwk) });
  writeFileSync(envelopeOut, JSON.stringify(signed, null, 2) + '\n');
  writeFileSync(keyOut, JSON.stringify(pubJwk, null, 2) + '\n');
  rmSync(tmp, { recursive: true, force: true });
  process.stdout.write(`fixture ready: ${envelopeOut} (+ public key ${keyOut})\n`);
}

main();