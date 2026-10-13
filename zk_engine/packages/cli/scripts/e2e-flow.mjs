/* global console, process, setTimeout, fetch, Buffer */
/**
 * E2E flow validation — the developer golden path, end to end:
 *
 *   anvil → forge deploy (registry) → API server → zk env set →
 *   zk new → zk prove → zk verify --offline → zk register →
 *   zk status → zk registry → zk verify (online) → shutdown
 *
 * Requires `anvil` + `forge` on PATH (foundry) and a fresh build
 * (`npm run build`). Skips with a clear message otherwise. Uses only the
 * built bin (packages/cli/dist/cli.js) on an isolated HOME, like a user.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const cliBin = join(repo, 'packages', 'cli', 'dist', 'cli.js');
const apiBin = join(repo, 'packages', 'api', 'dist', 'index.js');
const contractsDir = join(repo, 'contracts');
const RPC_URL = 'http://127.0.0.1:8545';
const API_BASE = 'http://127.0.0.1:8080';
const CLIENT_ID = 'e2e-client';
const SECRET = 'e2e-secret-'.padEnd(40, 'x');
// anvil account #0 (default anvil pk, matches foundry default)
const ANVIL_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function cli(args, opts = {}) {
  return spawnSync(process.execPath, [cliBin, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

async function waitFor(check, what, timeoutMs = 60_000) {
  const start = Date.now();
  for (;;) {
    try {
      const ok = await check();
      if (ok) return;
    } catch { /* retry */ }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

function ok(cond, msg) {
  if (!cond) throw new Error(`E2E FAIL: ${msg}`);
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

async function main() {
  const procs = [];
  const work = mkdtempSync(join(tmpdir(), 'zk-e2e-'));
  const home = join(work, 'home');
  mkdirSync(home, { recursive: true });
  const userEnv = { ...process.env, HOME: home, USERPROFILE: home };

  try {
    // 0. prereq check
    if (!existsSync(cliBin)) throw new Error('build first: npm run build (missing dist/cli.js)');
    if (!existsSync(apiBin)) throw new Error('build first: npm run build (missing api dist/index.js)');
    if (spawnSync('anvil', ['--version']).status !== 0 || spawnSync('forge', ['--version']).status !== 0) {
      console.log('skipping E2E: anvil/forge not on PATH (foundry required)');
      return 0;
    }

    // 1. anvil
    console.log('1. anvil on :8545');
    const anvil = spawn('anvil', ['--port', '8545', '--silent'], { stdio: ['ignore', 'ignore', 'inherit'] });
    procs.push(anvil);
    await waitFor(() => fetchJson('http://127.0.0.1:8545', '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'), 'anvil rpc');

    // 2. forge deploy registry
    console.log('2. forge deploy');
    const deploy = spawnSync(
      'forge',
      ['script', 'script/Deploy.s.sol', '--rpc-url', RPC_URL, '--broadcast', '--private-key', ANVIL_PK, '--silent'],
      { cwd: contractsDir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    );
    if (deploy.status !== 0) throw new Error(`forge deploy failed: ${deploy.stderr}`);
    const proxy = extractProxy(contractsDir);
    if (!proxy || !/^0x[a-fA-F0-9]{40}$/.test(proxy)) throw new Error('invalid or no ERC1967Proxy address in broadcast output');
    console.log(`   registry proxy: ${proxy}`);
    ok(proxy.startsWith('0x'), 'deployed registry proxy');

    // 3. API server (registry-backed, write-capable)
    console.log('3. API on :8080');
    const api = spawn(
      process.execPath,
      [apiBin],
      {
        env: {
          ...userEnv,
          ZK_PORT: '8080',
          ZK_HOST: '127.0.0.1',
          ZK_API_KEYS: `${CLIENT_ID}:${SECRET}:read,submit,write`,
          ZK_REGISTRY_RPC: RPC_URL,
          ZK_REGISTRY_PROXY: proxy,
          ZK_REGISTRY_PK: ANVIL_PK,
          ZK_OTEL_DISABLED: '1',
          ZK_LOG_LEVEL: 'error',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    procs.push(api);
    api.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));
    await waitFor(() => fetchJsonApi('/v1/health'), 'api health');

    // 4. golden path
    console.log('4. golden path');
    let r = cli(['env', 'set', '--api-url', API_BASE, '--client-id', CLIENT_ID, '--secret', SECRET], { env: userEnv, cwd: work });
    ok(r.status === 0, 'zk env set');

    r = cli(['new', 'poseidon-preimage', 'proj'], { env: userEnv, cwd: work });
    ok(r.status === 0 && existsSync(join(work, 'proj', 'inputs.json')), 'zk new');

    const proofFile = join(work, 'proj', 'proof.json');
    r = cli(['prove', 'poseidon-preimage', join(work, 'proj', 'inputs.json'), '--out', proofFile], { env: userEnv, cwd: work });
    ok(r.status === 0 && existsSync(proofFile), 'zk prove');

    r = cli(['verify', proofFile, '--offline'], { env: userEnv, cwd: work });
    ok(r.status === 0, 'zk verify --offline');

    console.log('5. register + status + registry + online verify');
    r = cli(['register', proofFile, '--idempotency-key', 'e2e-flow-001'], { env: userEnv, cwd: work });
    const regOut = r.stdout;
    ok(r.status === 0 && !r.stderr, `zk register (${r.status}): ${r.stderr || r.stdout}`);

    r = cli(['status', proofFile], { env: userEnv, cwd: work });
    ok(r.status === 0, `zk status (${r.status}): ${r.stderr || r.stdout}`);

    r = cli(['registry'], { env: userEnv, cwd: work });
    ok(r.status === 0 && /circuits.*poseidon|poseidon.*circuits|"circuits"/s.test(r.stdout), 'zk registry');

    r = cli(['verify', proofFile], { env: userEnv, cwd: work });
    ok(r.status === 0, 'zk verify (online)');

    const reg = parseRegisterJson(regOut);
    if (!reg) throw new Error('E2E FAIL: could not parse register output for on-chain gate');
    const gate = await onRequireProved(RPC_URL, proxy, 'poseidon-preimage', reg.publicInputHash);
    ok(gate.passed, `on-chain gate requireProved (${gate.detail})`);

    console.log('\nE2E OK: new → prove → verify → register → status → registry → verify (online) → requireProved gate — all green against anvil + API');
    return 0;
  } finally {
    for (const p of procs) {
      try { p.kill('SIGTERM'); } catch { /* ignore */ }
    }
    await new Promise((r) => setTimeout(r, 400));
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * On-chain gate: call requireProved(circuitId, publicInputHash, 0) on the
 * registry. The call must NOT revert (i.e. the proof is registered and,
 * with maxAge=0, unexpired). Raw JSON-RPC eth_call with a hand-built ABI
 * payload — selector from keccak256('requireProved(bytes32,bytes32,uint256)').
 */
async function onRequireProved(rpcUrl, proxy, circuitId, publicInputHash, maxAge = 0) {
  const pad32 = (hex) => {
    const h = hex.replace(/^0x/, '');
    return '0x' + h.padStart(64, '0');
  };
  const utf8Hex = Buffer.from(circuitId, 'utf8').toString('hex');
  const data =
    '0x88d5cfd7' +
    utf8Hex.padEnd(64, '0') +
    pad32(publicInputHash).slice(2) +
    maxAge.toString(16).padStart(64, '0');
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: proxy, data }, 'latest'] }),
  });
  const json = await res.json();
  if (json.error) {
    return { passed: false, detail: `revert: ${json.error.message ?? json.error.code}` };
  }
  return { passed: true, detail: `registered ${circuitId} mustFinish at ${maxAge}` };
}
async function fetchJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  return res.ok;
}
async function fetchJsonApi(path) {
  const res = await fetch(`${API_BASE}${path}`);
  return res.ok;
}

/** Find the ERC1967Proxy address in the latest broadcast JSON. */
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