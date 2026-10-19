#!/usr/bin/env node
/**
 * Gatekeeper probe CLI (M8 v2) — thin wrapper over `gatekeeper-lib.mjs`.
 *
 *   node scripts/gatekeeper-probe.mjs \
 *     --envelope proof.json \
 *     [--public-key '<ed25519 JWK json>' | --public-key-file <path>] \
 *     [--require-signed] [--circuit <id>] [--vk-allowlist 'k=v;...'] \
 *     [--artifact-dir <dir>] [--skip-artifact-hash] \
 *     [--rpc-url <url> --registry <proxy> --max-age <seconds>] \
 *     [--json-report]
 *
 * Exits 0 when verified, 1 when the gate blocks, 2 on usage errors.
 */

/* global console, process */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runGate } from './gatekeeper-lib.mjs';

function usage() {
  console.error(
    'usage: gatekeeper-probe.mjs --envelope <file> [--public-key <jwk>|--public-key-file <path>]\n' +
      '  [--require-signed] [--circuit <id>] [--vk-allowlist <k=v,...>]\n' +
      '  [--artifact-dir <dir>] [--skip-artifact-hash]\n' +
      '  [--rpc-url <url> --registry <proxy> --max-age <seconds>] [--json-report]',
  );
}

function parseArgs(argv) {
  const flags = {
    envelope: undefined,
    publicKey: undefined,
    publicKeyFile: undefined,
    requireSigned: false,
    circuit: undefined,
    allowlist: undefined,
    artifactDir: undefined,
    skipArtifactHash: false,
    rpcUrl: undefined,
    registry: undefined,
    maxAge: 0,
    jsonReport: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--envelope':
        flags.envelope = argv[++i];
        break;
      case '--public-key':
        flags.publicKey = argv[++i];
        break;
      case '--public-key-file':
        flags.publicKeyFile = argv[++i];
        break;
      case '--require-signed':
        flags.requireSigned = true;
        break;
      case '--circuit':
        flags.circuit = argv[++i];
        break;
      case '--vk-allowlist':
        flags.allowlist = argv[++i];
        break;
      case '--artifact-dir':
        flags.artifactDir = argv[++i];
        break;
      case '--skip-artifact-hash':
        flags.skipArtifactHash = true;
        break;
      case '--rpc-url':
        flags.rpcUrl = argv[++i];
        break;
      case '--registry':
        flags.registry = argv[++i];
        break;
      case '--max-age':
        flags.maxAge = Number(argv[++i]);
        break;
      case '--json-report':
        flags.jsonReport = true;
        break;
      case '--help':
      case '-h':
        usage();
        process.exit(2);
        break;
      default:
        if (a.startsWith('--')) {
          console.error(`unknown flag ${a}`);
          usage();
          process.exit(2);
        }
    }
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (!flags.envelope) {
    usage();
    process.exit(2);
  }
  let publicKey = flags.publicKey;
  if (flags.publicKeyFile && !publicKey) {
    // File is the fallback; an explicit --public-key (e.g. from a repository
    // secret) always wins.
    publicKey = await readFile(resolve(process.cwd(), flags.publicKeyFile), 'utf8');
  }
  const registry =
    flags.rpcUrl && flags.registry
      ? { rpcUrl: flags.rpcUrl, proxy: flags.registry, maxAge: flags.maxAge }
      : undefined;
  const { verified, report } = await runGate(
    {
      envelopeFile: flags.envelope,
      trustedPublicKey: publicKey,
      requireSigned: flags.requireSigned,
      circuit: flags.circuit,
      vkAllowlist: flags.allowlist,
      artifactDir: flags.artifactDir,
      requireArtifactHash: !flags.skipArtifactHash,
      registry,
    },
    {},
  );
  if (flags.jsonReport || process.env.GATEKEEPER_JSON === '1') {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(verified ? 'gate: verified\n' : 'gate: blocked\n');
  }
  for (const r of report.reasons) process.stderr.write(`  gate: ${r}\n`);
  process.exit(verified ? 0 : 1);
}

main();
