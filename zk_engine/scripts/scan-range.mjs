#!/usr/bin/env node
/**
 * Secret-scan commit range resolver (release guard).
 *
 * Produces `gitleaks detect` git log options that are NEVER an invalid
 * revision range — the failure mode that took down the Gitleaks action
 * (it emitted `root_commit^..HEAD`, which git rejects because the root
 * commit has no parent).
 *
 * Input (env):
 *   GITHUB_EVENT_NAME        push | pull_request | pull_request_target | ...
 *   GITHUB_PUSH_BEFORE       github.event.before (push only; zero on first push)
 *   GITHUB_PR_BASE_SHA       github.event.pull_request.base.sha
 *   GITHUB_PR_HEAD_SHA       github.event.pull_request.head.sha
 *
 * Output: one line on stdout, e.g.
 *   --no-merges --first-parent <base>^..HEAD   (push, base has a parent)
 *   --no-merges <base>..<head>                 (pull_request / target)
 *   --all --no-merges                          (fallback: full reachable history)
 *
 * The resolver never exits non-zero: resolution problems fall back to a
 * full-history scan, so the secret gate can never be skipped by a range
 * error — it can only fail on actual findings. Use `--selftest` to validate
 * the logic against scratch repos (CI regression guard).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FULL_HISTORY = '--all --no-merges';

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function gitCwd(env) {
  return env.GIT_CWD || process.cwd();
}

export function commitExists(sha, cwd) {
  if (!/^[0-9a-f]{40}$/.test(String(sha ?? ''))) return false;
  try {
    git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

function hasParent(sha, cwd) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${sha}^`], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve scan log options from GitHub Actions env. Falls back to a full
 * history scan; never throws, never emits an invalid range.
 */
export function resolveScanOptions(env = process.env) {
  const event = env.GITHUB_EVENT_NAME ?? '';
  const cwd = gitCwd(env);

  if (event.startsWith('pull_request')) {
    const base = env.GITHUB_PR_BASE_SHA ?? '';
    const head = env.GITHUB_PR_HEAD_SHA ?? '';
    if (commitExists(base, cwd) && commitExists(head, cwd)) {
      // base..head covers exactly the PR commits (merges excluded).
      return `--no-merges ${base}..${head}`;
    }
    console.warn(
      `[scan-range] PR range unresolvable (base=${base ? base.slice(0, 8) : '(empty)'}, head=${head ? head.slice(0, 8) : '(empty)'}); falling back to full history`,
    );
    return FULL_HISTORY;
  }

  // push (and local runs): prefer event.before; never emit <root>^.
  const before = env.GITHUB_PUSH_BEFORE ?? '';
  if (commitExists(before, cwd)) {
    if (hasParent(before, cwd)) {
      // base^..HEAD includes the base commit itself — the intended
      // "commits introduced since the previous ref" semantics.
      return `--no-merges --first-parent ${before}^..HEAD`;
    }
    console.warn(`[scan-range] push base ${before.slice(0, 8)} is a root commit (no parent); scanning full history`);
    return FULL_HISTORY;
  }
  if (before) {
    console.warn(`[scan-range] push base ${before.slice(0, 8)} not present in checkout; scanning full history`);
  }
  return FULL_HISTORY;
}

/**
 * Self-test against a scratch repository. Exits 1 on regression.
 */
export function selftest() {
  const dir = mkdtempSync(join(tmpdir(), 'zk-scan-range-'));
  const sh = (args, opts = {}) => git(args, { cwd: dir, ...opts });

  const makeCommit = (parent, body) => {
    const blob = sh(['hash-object', '-w', '--stdin'], { input: body }).trim();
    const tree = sh(['mktree'], { input: `100644 blob ${blob}\tfile\n` }).trim();
    const args = ['commit-tree', tree];
    if (parent) args.push('-p', parent);
    args.push('-m', `c:${body}`);
    return sh(args).trim();
  };

  try {
    sh(['init', '-q']);
    sh(['config', 'user.email', 'scan@example.invalid']);
    sh(['config', 'user.name', 'scan']);
    const c1 = makeCommit(null, 'root'); // root commit
    const c2 = makeCommit(c1, 'two');
    const c3 = makeCommit(c2, 'three');

    const wants = {
      'push with valid base': { env: { GIT_CWD: dir, GITHUB_EVENT_NAME: 'push', GITHUB_PUSH_BEFORE: c2 }, want: `--no-merges --first-parent ${c2}^..HEAD` },
      'push with zero before': { env: { GIT_CWD: dir, GITHUB_EVENT_NAME: 'push', GITHUB_PUSH_BEFORE: '0'.repeat(40) }, want: FULL_HISTORY },
      'push with root before': { env: { GIT_CWD: dir, GITHUB_EVENT_NAME: 'push', GITHUB_PUSH_BEFORE: c1 }, want: FULL_HISTORY },
      'push with unknown before': { env: { GIT_CWD: dir, GITHUB_EVENT_NAME: 'push', GITHUB_PUSH_BEFORE: 'f'.repeat(40) }, want: FULL_HISTORY },
      'push with missing before env': { env: { GIT_CWD: dir, GITHUB_EVENT_NAME: 'push' }, want: FULL_HISTORY },
      'pr with full refs': { env: { GIT_CWD: dir, GITHUB_EVENT_NAME: 'pull_request', GITHUB_PR_BASE_SHA: c1, GITHUB_PR_HEAD_SHA: c3 }, want: `--no-merges ${c1}..${c3}` },
      'pr missing head': { env: { GIT_CWD: dir, GITHUB_EVENT_NAME: 'pull_request', GITHUB_PR_BASE_SHA: c1, GITHUB_PR_HEAD_SHA: 'f'.repeat(40) }, want: FULL_HISTORY },
      'pr-target with full refs': { env: { GIT_CWD: dir, GITHUB_EVENT_NAME: 'pull_request_target', GITHUB_PR_BASE_SHA: c1, GITHUB_PR_HEAD_SHA: c3 }, want: `--no-merges ${c1}..${c3}` },
      'unknown event defaults to full': { env: { GIT_CWD: dir }, want: FULL_HISTORY },
    };

    let failed = false;
    for (const [name, t] of Object.entries(wants)) {
      const got = resolveScanOptions({ ...process.env, ...t.env });
      if (got !== t.want) {
        console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(t.want)}`);
        failed = true;
      } else {
        console.log(`ok   ${name}`);
      }
    }
    if (failed) process.exit(1);
    console.log(`ok   selftest complete (${Object.keys(wants).length} cases)`);
  } finally {
    // scratch dir is left for debugging; nothing sensitive is written.
  }
}

if (process.argv.includes('--selftest')) {
  selftest();
} else {
  process.stdout.write(resolveScanOptions() + '\n');
}