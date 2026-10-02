/**
 * Dashboard e2e smoke: boots the real dashboard server (no engine API),
 * logs in via the session flow, and asserts the gatekeeper BFF contract
 * (list + detail), circuit metadata, and the web shell.
 *
 * Run: node scripts/smoke-dashboard.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixturesDir = mkdtempSync(join(tmpdir(), 'zk-dash-smoke-'));
const pass = {
  file: '2026-08-09-registered-pass.json',
  verified: true,
  circuitId: 'poseidon-preimage@1',
  vkHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
  artifactHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
  publicInputHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
  keyId: 'key-1',
  reasons: [],
  checks: [
    { name: 'metadata.author', ok: true, detail: 'allowlisted' },
    { name: 'artifact.hash', ok: true, detail: 'matches manifest' },
    { name: 'registry', ok: true, detail: 'registered' },
  ],
  onChain: { active: true, status: 'confirmed' },
};
const blocked = {
  ...pass,
  file: '2026-08-08-registered-blocked.json',
  verified: false,
  artifactHash: null,
  reasons: ['metadata.author not in allowlist', 'artifact missing'],
  checks: pass.checks.map((c) => ({ ...c, ok: false, detail: 'nope' })),
  onChain: null,
};
for (const report of [pass, blocked]) writeFileSync(join(fixturesDir, report.file), JSON.stringify(report, null, 2));


const PORT = 3911;
const BASE = `http://127.0.0.1:${PORT}`;
const PASS = 'smoke-password-123';

const server = spawn('node', ['dist/server/server/main.js'], {
  cwd: new URL('../packages/dashboard', import.meta.url).pathname,
  env: {
    ...process.env,
    ZK_DASHBOARD_PORT: String(PORT),
    ZK_DASHBOARD_INSECURE_DEV: '1',
    ZK_DASHBOARD_PASSWORD: PASS,
    ZK_DASHBOARD_GATE_REPORTS: fixturesDir,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

function waitUp(ms = 10000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (Date.now() - start > ms) return reject(new Error('server never came up'));
      try {
        const r = await fetch(BASE);
        if (r.status === 200 || r.status === 401) return resolve();
      } catch {}
      setTimeout(tick, 200);
    };
    tick();
  });
}

let cookies = '';
async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASS }),
  });
  const setCookie = r.headers.get('set-cookie');
  check('login returns 200 + session cookie', r.status === 200 && Boolean(setCookie?.includes('zkdash')));
  cookies = setCookie.split(';')[0];
}

async function authed(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie: cookies } });
  return { status: r.status, body: await r.json() };
}

async function run() {
  await waitUp();

  const pre = await fetch(BASE);
  check('shell gated behind auth', pre.status === 401);

  await login();

  const shell = await fetch(BASE, { headers: { cookie: cookies } });
  const csp = shell.headers.get('content-security-policy');
  const shellBody = await shell.text();
  check('web shell served after auth with CSP', shell.status === 200 && csp?.includes("script-src 'self'") === true && shellBody.includes('<div id="root"'), `status=${shell.status} csp=${csp?.slice(0, 30)} len=${shellBody.length}`);

  const unauth = await fetch(`${BASE}/api/gatekeeper`);
  check('gatekeeper requires auth', unauth.status === 401);

  const bad = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'nope' }),
  });
  check('wrong password rejected', bad.status === 401);

  for (const path of ['/api/gatekeeper', '/api/circuits', '/api/registry', '/api/audit?limit=10']) {
    const { status } = await authed(path);
    const expect503 = path !== '/api/gatekeeper';
    check(`auth ok for ${path}`, status === (expect503 ? 503 : 200), `status=${status}`);
  }

  const gate = await authed('/api/gatekeeper');
  check('gatekeeper overview shape', Array.isArray(gate.body.reports) && gate.body.count === 2, `count=${gate.body.count}`);
  check('gatekeeper latest is the verified pass', gate.body.latest?.verified === true, `file=${gate.body.latest?.file}`);

  const detail = await authed('/api/gatekeeper/report/2026-08-08-registered-blocked.json');
  check(
    'blocked report detail shows reasons + checks',
    detail.status === 200 &&
      detail.body.verified === false &&
      detail.body.reasons.length === 2 &&
      detail.body.checks.length === 3,
    `reasons=${detail.body.reasons?.length}`,
  );

  const missing = await authed('/api/gatekeeper/report/nope.json');
  check('missing report → 404', missing.status === 404);

  const audit = await authed('/api/audit?limit=50');
  check('audit unavailable without engine API (503)', audit.status === 503);
}

run()
  .catch((err) => {
    check('smoke script', false, err.message);
  })
  .finally(() => {
    server.kill('SIGTERM');
    setTimeout(() => process.exit(failures.length === 0 ? 0 : 1), 300);
  });
