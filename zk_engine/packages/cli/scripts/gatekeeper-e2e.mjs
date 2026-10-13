/* global console, process, setTimeout, fetch, Buffer */
/**
 * Gatekeeper on-chain E2E (M8): exercises the REAL gate
 * (`gatekeeper-probe.mjs` + `gatekeeper-lib.mjs`) against a live anvil
 * registry through the full stack:
 *
 *   anvil → forge deploy (registry) → API → zk new/prove/register →
 *   gate probe with on-chain enforcement:
 *     1. registered proof             → PASS
 *     2. expired proof (maxAge)       → BLOCK
 *     3. revoked proof (revokeProof)  → BLOCK
 *     4. unregistered proof           → BLOCK
 *
 * Requires foundry (`anvil`/`forge`/`cast`), a fresh build and the gate key
 * fixture. Skips with a clear message otherwise.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, signEnvelope } from '@zkpe/keys';
import { publicInputHash } from '@zkpe/proof-format';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const cliBin = join(repo, 'packages', 'cli', 'dist', 'cli.js');
const apiBin = join(repo, 'packages', 'api', 'dist', 'index.js');
const probeBin = join(repo, 'packages', 'cli', 'scripts', 'gatekeeper-probe.mjs');
const contractsDir = join(repo, 'contracts');
const RPC_URL = 'http://127.0.0.1:8547';
const API_BASE = 'http://127.0.0.1:8081';
const CLIENT_ID = 'gk-e2e-client';
const SECRET = 'gk-e2e-secret-'.padEnd(40, 'x');
const ANVIL_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function cli(args, opts = {}) {
  return spawnSync(process.execPath, [cliBin, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

async function waitFor(check, what, timeoutMs = 60_000) {
  const start = Date.now();
  for (;;) {
    try {
      if (await check()) return;
    } catch { /* retry */ }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

function ok(cond, msg) {
  if (!cond) throw new Error(`GATE-E2E FAIL: ${msg}`);
  console.log(`  ok: ${msg}`);
}

function parseRegisterJson(stdout) {
  try {
    const start = stdout.indexOf('{');
    if (start < 0) return null;
    return JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
}

/** Run the gate probe with on-chain enforcement; returns {verified, report}. */
async function gateProbe(envelopeFile, publicKey, registry, maxAge = 0) {
  const r = spawnSync(
    process.execPath,
    [probeBin, '--envelope', envelopeFile, '--public-key', publicKey, '--artifact-dir', join(repo, 'packages/circuit-lib/build'),
      '--rpc-url', RPC_URL, '--registry', registry, '--max-age', String(maxAge), '--json-report'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const report = r.stdout.trim() ? JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))) : null;
  return { verified: r.status === 0, report };
}

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function main() {
  const procs = [];
  const work = mkdtempSync(join(tmpdir(), 'zk-gke2e-'));
  const home = join(work, 'home');
  mkdirSync(home, { recursive: true });
  const userEnv = { ...process.env, HOME: home, USERPROFILE: home };

  let proxy = '';
  try {
    if (!existsSync(cliBin) || !existsSync(apiBin)) throw new Error('build first: npm run build');
    for (const tool of ['anvil', 'forge', 'cast']) {
      if (spawnSync(tool, ['--version']).status !== 0) {
        console.log('skipping gatekeeper E2E: foundry tools not on PATH');
        return 0;
      }
    }

    // 1. anvil
    console.log('1. anvil on :8547');
    const anvil = spawn('anvil', ['--port', '8547', '--silent'], { stdio: ['ignore', 'ignore', 'inherit'] });
    procs.push(anvil);
    await waitFor(() => rpc('eth_blockNumber', []), 'anvil rpc');

    // 2. forge deploy
    console.log('2. forge deploy');
    const deploy = spawnSync(
      'forge', ['script', 'script/Deploy.s.sol', '--rpc-url', RPC_URL, '--broadcast', '--private-key', ANVIL_PK, '--silent'],
      { cwd: contractsDir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    );
    if (deploy.status !== 0) throw new Error(`forge deploy failed: ${deploy.stderr}`);
    proxy = extractProxy(contractsDir);
    if (!proxy) throw new Error('no ERC1967Proxy in broadcast output');
    console.log(`   registry proxy: ${proxy}`);

    // 3. API
    console.log('3. API on :8081');
    const api = spawn(process.execPath, [apiBin], {
      env: {
        ...userEnv,
        ZK_PORT: '8081',
        ZK_HOST: '127.0.0.1',
        ZK_API_KEYS: `${CLIENT_ID}:${SECRET}:read,submit,write`,
        ZK_REGISTRY_RPC: RPC_URL,
        ZK_REGISTRY_PROXY: proxy,
        ZK_REGISTRY_PK: ANVIL_PK,
        ZK_OTEL_DISABLED: '1',
        ZK_LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    procs.push(api);
    api.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));
    await waitFor(async () => (await fetch(`${API_BASE}/v1/health`)).ok, 'api health');

    // 4. golden path through the API
    console.log('4. golden path');
    let r = cli(['env', 'set', '--api-url', API_BASE, '--client-id', CLIENT_ID, '--secret', SECRET], { env: userEnv, cwd: work });
    ok(r.status === 0, 'zk env set');
    r = cli(['new', 'poseidon-preimage', 'proj'], { env: userEnv, cwd: work });
    ok(r.status === 0 && existsSync(join(work, 'proj', 'inputs.json')), 'zk new');
    const proofFile = join(work, 'proj', 'proof.json');
    r = cli(['prove', 'poseidon-preimage', join(work, 'proj', 'inputs.json'), '--out', proofFile], { env: userEnv, cwd: work });
    ok(r.status === 0 && existsSync(proofFile), 'zk prove');

    // 5. sign the envelope with a gate key (as a maintainer would)
    console.log('5. sign envelope + register on-chain');
    const key = generateKeyPair();
    const env = JSON.parse(readFileSync(proofFile, 'utf8'));
    const signed = signEnvelope(env, { kind: 'privateJwk', privateJwk: key.privateJwk });
    const signedFile = join(work, 'signed-proof.json');
    writeFileSync(signedFile, JSON.stringify(signed, null, 2));

    r = cli(['register', proofFile, '--idempotency-key', 'gk-e2e-001'], { env: userEnv, cwd: work });
    const regOut = r.stdout;
    ok(r.status === 0 && !r.stderr, 'zk register');
    const reg = parseRegisterJson(regOut);
    if (!reg) throw new Error('could not parse register output');
    const anchor = reg.publicInputHash ?? publicInputHash(signed.publicInputs);
    ok(/^0x[0-9a-f]{64}$/.test(anchor), `anchor ${anchor}`);
    const pub = JSON.stringify(key.publicJwk);
    const circuitId32 = '0x' + Buffer.from('poseidon-preimage', 'utf8').toString('hex').padEnd(64, '0');

    // 6. scenario 1 — registered proof PASSES the real gate
    console.log('6. gate scenarios');
    let g = await gateProbe(signedFile, pub, proxy);
    if (g.report) {
      const chain = g.report.checks.filter((c) => c.name.startsWith('on-chain'));
      console.log('   on-chain checks:', chain.map((c) => `${c.name}=${c.ok} (${c.detail})`).join(' | '));
    }
    ok(g.verified, 'registered proof passes the gate (on-chain enforcement)');
    const leafCheck = g.report?.checks.find((c) => c.name === 'on-chain-proof');
    ok(leafCheck?.ok === true, `exact proof leaf anchored (${leafCheck?.detail})`);

    // 7. scenario 2 — expiry: jump time past provedAt+maxAge, gate must BLOCK
    console.log('7. expiry scenario');
    await rpc('evm_increaseTime', ['100000000']);
    await rpc('evm_mine', []);
    g = await gateProbe(signedFile, pub, proxy, 3600);
    ok(!g.verified, 'expired proof is BLOCKED by maxAge');
    g = await gateProbe(signedFile, pub, proxy, 0);
    ok(g.verified, 'same proof still passes with maxAge=0 (no expiry policy)');

    // 8. scenario 3 — revokeProof, gate must BLOCK
    console.log('8. revoke scenario');
    const revoke = spawnSync(
      'cast', ['send', proxy, 'revokeProof(bytes32,bytes32)', circuitId32, anchor, '--rpc-url', RPC_URL, '--private-key', ANVIL_PK, '--silent'],
      { encoding: 'utf8' },
    );
    if (revoke.status !== 0) throw new Error(`cast revokeProof failed: ${revoke.stderr}`);
    g = await gateProbe(signedFile, pub, proxy, 0);
    ok(!g.verified, 'revoked proof is BLOCKED');
    const statusCheck = g.report?.checks.find((c) => c.name === 'on-chain-status');
    ok(statusCheck?.detail?.includes('revoked'), `gate reports revoked (${statusCheck?.detail})`);

    // 9. scenario 4 — proof never registered, gate must BLOCK
    console.log('9. unregistered scenario');
    const otherInputs = join(work, 'proj2');
    cli(['new', 'poseidon-preimage', 'proj2'], { env: userEnv, cwd: work });
    const otherProof = join(otherInputs, 'proof.json');
    r = cli(['prove', 'poseidon-preimage', join(otherInputs, 'inputs.json'), '--out', otherProof], { env: userEnv, cwd: work });
    ok(r.status === 0 && existsSync(otherProof), 'second proof (unregistered)');
    const env2 = JSON.parse(readFileSync(otherProof, 'utf8'));
    const signed2 = signEnvelope(env2, { kind: 'privateJwk', privateJwk: key.privateJwk });
    const signed2File = join(work, 'signed-unregistered.json');
    writeFileSync(signed2File, JSON.stringify(signed2, null, 2));
    g = await gateProbe(signed2File, pub, proxy, 0);
    ok(!g.verified, 'unregistered proof is BLOCKED');
    const leafMissing = g.report?.checks.find((c) => c.name === 'on-chain-proof');
    ok(leafMissing?.ok === false, `exact proof leaf absent for unregistered proof (${leafMissing?.detail})`);

    console.log('\nGATE-E2E OK: registered → PASS | expired → BLOCK | revoked → BLOCK | unregistered → BLOCK (all against anvil registry via the real gate)');
    return 0;
  } finally {
    for (const p of procs) {
      try { p.kill('SIGTERM'); } catch { /* ignore */ }
    }
    await new Promise((r) => setTimeout(r, 400));
    rmSync(work, { recursive: true, force: true });
  }
}

function extractProxy(dir) {
  const candidates = ['broadcast/Deploy.s.sol/1/run-latest.json', 'broadcast/Deploy.s.sol/31337/run-latest.json'];
  for (const rel of candidates) {
    try {
      const json = JSON.parse(readFileSync(join(dir, rel), 'utf8'));
      for (const tx of json.transactions ?? []) {
        if (tx.contractName === 'ERC1967Proxy' && tx.contractAddress) return tx.contractAddress;
      }
    } catch { /* try next */ }
  }
  return null;
}

void main().then(
  (code) => process.exit(code ?? 0),
  (err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); },
);
