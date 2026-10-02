#!/usr/bin/env node
/* global console, process */
/**
 * Fresh-install validation:
 *   1. npm pack every @zkpe/* workspace package the CLI needs
 *   2. install the resulting tarballs into an isolated scratch project
 *   3. smoke-run the installed `zk` bin (no repo cwd, no local node_modules)
 *
 * This proves the published-ish artifact set (files list, bin wiring, and
 * dependency ranges) is installable and runnable from scratch.
 *
 * npm gotcha: tarballs must live in a *persistent* location while npm's
 * content cache may reference them; deleting the dir mid-install poisons
 * the cache with ENOENT/corruption warnings.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PACKS = [
  'packages/proof-format',
  'packages/circuit-lib',
  'packages/keys',
  'packages/engine',
  'packages/api',
  'packages/cli',
];

function npm(...args) {
  const opts = typeof args[args.length - 1] === 'object' ? args.pop() : {};
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  // .cmd files (Windows) are not directly spawnable — run through the shell.
  opts.shell = process.platform === 'win32';
  // Windows gotcha: piped stdio can make execFileSync wait on grandchild
  // handles that outlive npm (stuck 40-min CI legs). The install phase
  // inherits the console so completion is driven by process exit; every
  // call is time-bounded so a stuck run FAILS LOUDLY instead of hanging.
  opts.stdio = opts.stdio ?? 'pipe';
  opts.timeout = opts.timeout ?? 10 * 60 * 1000;
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

function run(zkBin, args, cwd) {
  return execFileSync(zkBin, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: cwd, USERPROFILE: cwd },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Outputs below are asserted on, so pipes stay; a timeout turns a hang
    // into a hard failure with a diagnostic instead of a silent CI stall.
    timeout: 60 * 1000,
    // .cmd shims (Windows) are not directly spawnable — run via the shell.
    shell: process.platform === 'win32',
  });
}

const projectDir = mkdtempSync(join(tmpdir(), 'zk-fresh-'));
const tarballDir = join(projectDir, '_tarballs');
const tarballs = [];
const tgzNames = [];

try {
  mkdirSync(tarballDir);
  for (const pkg of PACKS) {
    const out = npm('pack', '--pack-destination', tarballDir, { cwd: join(repo, pkg) });
    const tgz = out.trim().split('\n').pop();
    if (!tgz || !existsSync(join(tarballDir, tgz))) throw new Error(`npm pack produced no tarball for ${pkg}`);
    console.log(`packed ${tgz}`);
    tarballs.push(join(tarballDir, tgz));
    tgzNames.push(tgz);
  }

const zkpeDeps = Object.fromEntries(
    PACKS.map((p, i) => [`@zkpe/${p.split('/')[1]}`, `file:./_tarballs/${tgzNames[i]}`]),
  );
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fresh-install-check',
        private: true,
        type: 'module',
        dependencies: zkpeDeps,
        // Transitive @zkpe/* deps inside the tarballs reference plain versions
        // (e.g. "@zkpe/proof-format": "0.2.0") — force them onto the local
        // tarballs, mirroring what a published registry would provide.
        overrides: zkpeDeps,
      },
      null,
      2,
    ),
  );
  console.log('installing tarballs into ' + projectDir);
  npm('install', '--no-audit', '--no-fund', '--loglevel=error', { cwd: projectDir, stdio: 'inherit' });

  const zkBin = join(projectDir, 'node_modules', '.bin', process.platform === 'win32' ? 'zk.cmd' : 'zk');

  const help = run(zkBin, ['--help'], projectDir);
  for (const cmd of ['prove', 'verify', 'register', 'deploy']) {
    if (help.includes(cmd) === false) throw new Error(`fresh install help missing command: ${cmd}`);
  }

  const envSet = run(zkBin, ['env', 'set', '--api-url', 'http://127.0.0.1:8080', '--client-id', 'fresh', '--secret', 's'.repeat(40)], projectDir);
  if (envSet.includes('<redacted>') === false) throw new Error('fresh install env set did not redact the secret');
  const envShow = run(zkBin, ['env', 'show'], projectDir);
  if (envShow.includes('<redacted:') === false) throw new Error(`fresh install env show did not redact: ${envShow}`);

  const _newOut = run(zkBin, ['new', 'poseidon-preimage', 'proj'], projectDir);
  if (existsSync(join(projectDir, 'proj', 'inputs.json')) === false) throw new Error('fresh install: zk new did not write inputs.json');

  console.log('fresh-install OK: pack → install → help/env/new all working');
} finally {
  try {
    rmSync(projectDir, { recursive: true, force: true });
  } catch {
    // Windows may keep files locked briefly after a timed-out npm child;
    // never mask the real failure with a cleanup error.
  }
}