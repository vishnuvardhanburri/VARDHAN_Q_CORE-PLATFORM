#!/usr/bin/env node
/**
 * Gatekeeper online check — submits the envelope for verification to the API
 * and requires `verified: true`. Used by the zk-verify GitHub Action when an
 * `api-url` is configured.
 *
 *   node scripts/gatekeeper-api-verify.mjs \
 *     --api-url <url> --client-id <id> --client-secret <secret> --envelope <file>
 */

/* global process */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ApiClient } from '@zkpe/api';

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--api-url' || a === '--client-id' || a === '--client-secret' || a === '--envelope') {
    flags[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = args[++i];
  }
}

async function main() {
  const { apiUrl, clientId, clientSecret, envelope } = flags;
  if (!apiUrl || !clientId || !clientSecret || !envelope) {
    process.stderr.write('usage: gatekeeper-api-verify.mjs --api-url <url> --client-id <id> --client-secret <secret> --envelope <file>\n');
    process.exit(2);
  }
  const raw = JSON.parse(await readFile(resolve(process.cwd(), envelope), 'utf8'));
  const client = new ApiClient({ baseUrl: apiUrl, clientId, secret: clientSecret });
  const result = await client.verifyProof({
    circuitId: raw.circuitId,
    proof: raw.proof,
    publicInputs: raw.publicInputs,
  });
  const verified = result && typeof result === 'object' && 'verified' in result && result.verified === true;
  if (!verified) {
    process.stderr.write(`gate: API verify rejected the envelope: ${JSON.stringify(result)}\n`);
    process.exit(1);
  }
  process.stdout.write(`API verify: OK (${raw.circuitId})\n`);
}

main().catch((err) => {
  process.stderr.write(`gate: API verify failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});