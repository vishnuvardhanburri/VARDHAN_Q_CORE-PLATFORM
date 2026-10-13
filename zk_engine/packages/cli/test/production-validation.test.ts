/**
 * Production validation — the real `zk` bin against a scratch HOME.
 *
 *   exit codes for every command
 *   secrets never appear in stdout/stderr
 *   snapshot tests for the output surface
 *   shell completion scripts (syntax + command coverage)
 *
 * Skip-gated on `dist/cli.js` existing (same policy as the engine suite).
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliBin = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const distReady = existsSync(cliBin);

const run = (args: string[], opts: { home?: string; cwd?: string } = {}): { code: number; stdout: string; stderr: string; timeout: boolean } => {
  const res = spawnSync(process.execPath, [cliBin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ZK_HOME: opts.home ?? join(homedir(), '.zk'), HOME: opts.home ?? homedir(), USERPROFILE: opts.home ?? homedir() },
    cwd: opts.cwd,
    timeout: 90_000,
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '', timeout: res.error !== undefined && res.error.message?.includes('ETIMEDOUT') === true };
};

describe.skipIf(!distReady)('zk bin production validation', () => {
  let home: string;

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'zk-home-'));
  });

  // ---- exit codes for every command -------------------------------------
  describe('exit codes', () => {
    const cases: [string, string[], number][] = [
      ['help', ['--help'], 0],
      ['help (bare)', [], 0],
      ['completions bash', ['completions', 'bash'], 0],
      ['completions zsh', ['completions', 'zsh'], 0],
      ['completions fish', ['completions', 'fish'], 0],
      ['unknown command', ['frobnicate'], 2],
      ['unknown flag', ['prove', '--bogus'], 2],
      ['prove missing args', ['prove'], 2],
      ['verify missing file', ['verify'], 2],
      ['register missing idem-key', ['register', 'x.json'], 2],
      ['status missing file', ['status'], 2],
      ['env unknown subcommand', ['env', 'frob'], 2],
      ['completions bad shell', ['completions', 'tcsh'], 2],
      ['verify nonexistent envelope', ['verify', '/no/such/proof.json'], 1],
      ['env show no profile', ['env', 'show'], 1],
    ];

    for (const [name, args, expected] of cases) {
      it(`${name} → ${expected}`, () => {
        const r = run(args, { home });
        expect(r.timeout, `${args.join(' ')} hit 90s timeout (a hang)`).toBe(false);
        expect(r.code).toBe(expected);
      });
    }
  });

  // ---- secret redaction --------------------------------------------------
  describe('secret redaction', () => {
    const SUPER_SECRET = 'secret-value-8c3f-1a2b9d4e-validate-never-leak';
    let envHome: string;

    beforeAll(() => {
      envHome = mkdtempSync(join(tmpdir(), 'zk-sec-'));
      const r = run(['env', 'set', '--api-url', 'http://127.0.0.1:9', '--client-id', 'cli-a', '--secret', SUPER_SECRET], { home: envHome });
      expect(r.code).toBe(0);
    });

    it('env show redacts the secret', () => {
      const r = run(['env', 'show'], { home: envHome });
      expect(r.code).toBe(0);
      expect(r.stdout).not.toContain(SUPER_SECRET);
      expect(r.stdout).toContain('<redacted:');
    });

    it('env list does not leak the secret', () => {
      const r = run(['env', 'list'], { home: envHome });
      expect(r.code).toBe(0);
      expect(r.stdout + r.stderr).not.toContain(SUPER_SECRET);
    });

    it('registry against an unreachable API does not leak the secret', () => {
      const r = run(['registry'], { home: envHome });
      expect(r.code).toBe(1);
      expect(r.stdout + r.stderr).not.toContain(SUPER_SECRET);
    });

    it('register against an unreachable API does not leak the secret', () => {
      const r = run(['register', '/tmp/none.json', '--idempotency-key', 'idem-12345678'], { home: envHome });
      expect(r.code).toBe(1);
      expect(r.stdout + r.stderr).not.toContain(SUPER_SECRET);
    });

    it('profile file itself is 0600 and never echoed', () => {
      const prof = join(envHome, '.zk', 'dev.json');
      if (process.platform !== 'win32') {
        const { mode } = statSync(prof);
        expect(mode & 0o077).toBe(0);
      }
      const r = run(['env', 'show', 'missing'], { home: envHome });
      expect(r.code).toBe(1);
      expect(r.stdout + r.stderr).not.toContain(SUPER_SECRET);
    });
  });

  // ---- snapshots ----------------------------------------------------------
  describe('output snapshots', () => {
    it('--help matches the reference surface', () => {
      const r = run(['--help'], { home });
      expect(r.code).toBe(0);
      expect(r.stdout).toMatchSnapshot('help');
    });

    it('help (bare) matches --help', () => {
      const bare = run([], { home });
      const flag = run(['--help'], { home });
      expect(bare.stdout).toBe(flag.stdout);
    });

    it('env show redacted output is stable', () => {
      const r = run(['env', 'set', '--api-url', 'http://127.0.0.1:8080', '--client-id', 'client-1', '--secret', 'x'.repeat(40)], { home });
      expect(r.code).toBe(0);
      const shown = run(['env', 'show', 'dev'], { home });
      expect(shown.code).toBe(0);
      expect(shown.stdout).toMatchSnapshot('env-show');
    });

    it('env set success output shape is stable', () => {
      const r = run(['env', 'set', '--api-url', 'http://127.0.0.1:8080', '--client-id', 'client-2', '--secret', 'y'.repeat(40), 'prod'], { home });
      expect(r.code).toBe(0);
      expect(r.stdout).toMatchSnapshot('env-set');
    });

    it('completions list every command for each shell', () => {
      const commands = ['new', 'prove', 'verify', 'register', 'status', 'registry', 'deploy', 'env', 'completions'];
      for (const shell of ['bash', 'zsh', 'fish'] as const) {
        const r = run(['completions', shell], { home });
        expect(r.code).toBe(0);
        for (const cmd of commands) {
          expect(r.stdout, `${shell} missing ${cmd}`).toContain(cmd);
        }
      }
    });

    it('zsh completion is a valid compdef file', () => {
      const r = run(['completions', 'zsh'], { home });
      expect(r.stdout).toContain('#compdef zk');
      expect(r.stdout).toContain('compdef _zk zk');
    });
  });

  // ---- shell completion syntax ------------------------------------------
  describe('completion scripts parse', () => {
    it('bash script passes bash -n', () => {
      const r = run(['completions', 'bash'], { home });
      const res = spawnSync('bash', ['-n', '-c', r.stdout], { encoding: 'utf8', timeout: 15_000 });
      if (res.error) return; // bash not available (e.g. Windows CI)
      expect(res.status).toBe(0);
    });

    it('bash script completes commands under a simulated COMP_WORDS', () => {
      const r = run(['completions', 'bash'], { home });
      const script = `${r.stdout}
COMP_WORDS=(zk prov)
COMP_CWORD=1
_zk_complete
printf '%s\\n' "\${COMPREPLY[@]}"
`;
      const res = spawnSync('bash', ['-c', script], { encoding: 'utf8', timeout: 15_000 });
      if (res.error) return;
      expect(res.stdout.trim()).toContain('prove');
    });
  });
});