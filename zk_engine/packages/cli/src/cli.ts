#!/usr/bin/env node
/**
 * `zk` CLI bin — parse args → dispatch to command implementations → render.
 *
 * `runCli` is the importable, testable core (exit-code contract: 0 ok,
 * 1 runtime, 2 usage). The bin entry flushes stdio and exits explicitly:
 * the engine's snarkjs worker threads otherwise keep the process alive.
 */

import { homedir } from 'node:os';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { ApiClient, type ApiClientConfig } from '@zkpe/api';
import { ProfileStore } from './env.js';
import { parseArgs, UsageError, type ParsedArgs } from './args.js';
import { render, fmtStatus, errExit } from './output.js';
import type { CliCtx } from './commands.js';
import { completionScript } from './completions.js';

export function helpText(): string {
  return `zk — @zkpe developer CLI (M6)

USAGE
  zk <command> [flags]

COMMANDS
  new <circuitId> <dir>          scaffold a project (inputs template)
  prove <circuitId> <inputs>     generate a proof envelope (local engine)
    --out <file>                 envelope output (default proof.json)
  verify <envelope.json>         verify envelope locally; then API unless --offline
  register <envelope.json>       anchor a proof on-chain (requires --idempotency-key)
  status <envelope.json>         on-chain proof status via API
  registry                       registry info via API
  deploy --rpc-url <url>         deploy registry contracts via foundry script
  env [set|show|list] [env]     manage API profiles (dev/prod)
  completions [bash|zsh|fish]    print a shell completion script
  --help                          this help

FLAGS (global)
  --env <dev|prod>               profile name (default dev)
  --offline                      never call the API (local-only)
  --json                         machine-readable output (all commands)
`;
}

function profileDir(): string {
  return join(homedir(), '.zk');
}

function ctxFor(env: string, cwd = process.cwd()): CliCtx {
  return { env, cwd, store: new ProfileStore(profileDir()) };
}

async function clientFor(ctx: CliCtx): Promise<ApiClient> {
  const p = await ctx.store.load(ctx.env);
  return new ApiClient({ baseUrl: p.apiUrl, clientId: p.clientId, secret: p.secret } satisfies ApiClientConfig);
}

function str(a: ParsedArgs, name: string): string | undefined {
  const v = a.flags[name];
  return typeof v === 'string' ? v : undefined;
}

function is(a: ParsedArgs, name: string): boolean {
  return a.flags[name] === true;
}

let cmdsPromise: Promise<typeof import('./commands.js')> | undefined;
function loadCommands(): Promise<typeof import('./commands.js')> {
  cmdsPromise ??= import('./commands.js');
  return cmdsPromise;
}

/** Execute `zk` with argv, streaming to `process`. Returns the exit code. */
export async function runCli(argv: string[], cwd = process.cwd()): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`zk: ${message}\n`);
    return err instanceof UsageError ? 2 : 1;
  }
  const ctx = ctxFor(args.env, cwd);

  try {
    switch (args.command) {
      case 'help':
        process.stdout.write(helpText());
        return 0;
      case 'env': {
        const sub = args.positional[0] ?? 'show';
        if (sub === 'show') {
          const { cmdEnvShow } = await loadCommands();
          render({ kind: 'json', doc: await cmdEnvShow(ctx, args.positional[1]) });
          return 0;
        }
        if (sub === 'set') {
          const apiUrl = str(args, 'api-url');
          const clientId = str(args, 'client-id');
          const secret = str(args, 'secret');
          if (!apiUrl || !clientId || !secret) throw new UsageError('env set requires --api-url --client-id --secret');
          const env = args.positional[1] ?? args.env;
          const { cmdEnvSet } = await loadCommands();
          render({ kind: 'json', doc: await cmdEnvSet(ctx, { env, apiUrl, clientId, secret, create: true }) });
          return 0;
        }
        if (sub === 'list') {
          const { readdir } = await import('node:fs/promises');
          const names = (await readdir(profileDir()).catch(() => [])).filter((f) => f.endsWith('.json'));
          render({ kind: 'json', doc: { profiles: names } });
          return 0;
        }
        throw new UsageError(`unknown env subcommand "${sub}"`);
      }
      case 'new': {
        const [circuitId, dir] = args.positional;
        if (!circuitId || !dir) throw new UsageError('usage: zk new <circuitId> <dir>');
        const { cmdNew } = await loadCommands();
        const r = await cmdNew(ctx, circuitId, dir);
        render({ kind: 'text', lines: [`created ${r.inputsFile} (circuit ${r.circuitId})`] });
        return 0;
      }
      case 'prove': {
        const circuitId = args.positional[0] ?? str(args, 'circuit');
        const inputs = args.positional[1] ?? str(args, 'inputs');
        const out = str(args, 'out') ?? 'proof.json';
        if (!circuitId || !inputs) throw new UsageError('usage: zk prove <circuitId> <inputs> [--out file]');
        const { cmdProve } = await loadCommands();
        render({ kind: 'json', doc: await cmdProve(ctx, { circuitId, inputsFile: inputs, outFile: out }) });
        return 0;
      }
      case 'verify': {
        const file = args.positional[0] ?? str(args, 'file');
        if (!file) throw new UsageError('usage: zk verify <envelope.json>');
        const offline = is(args, 'offline');
        const { cmdVerify } = await loadCommands();
        const cmdArgs: { proofFile: string; client?: ApiClient; offline: boolean } = { proofFile: file, offline };
        if (!offline) cmdArgs.client = await clientFor(ctx);
        render({ kind: 'json', doc: await cmdVerify(ctx, cmdArgs) });
        return 0;
      }
      case 'register': {
        const file = args.positional[0] ?? str(args, 'file');
        const idempotencyKey = str(args, 'idempotency-key');
        if (!file || !idempotencyKey) throw new UsageError('usage: zk register <envelope.json> --idempotency-key <key>');
        const { cmdRegister } = await loadCommands();
        render({ kind: 'json', doc: await cmdRegister(ctx, { proofFile: file, idempotencyKey, client: await clientFor(ctx) }) });
        return 0;
      }
      case 'status': {
        const file = args.positional[0] ?? str(args, 'file');
        if (!file) throw new UsageError('usage: zk status <envelope.json>');
        const { cmdStatus } = await loadCommands();
        const r = await cmdStatus(ctx, { proofFile: file, client: await clientFor(ctx) });
        render({ kind: 'text', lines: [fmtStatus(r)] });
        return 0;
      }
      case 'registry': {
        const { cmdRegistry } = await loadCommands();
        render({ kind: 'json', doc: await cmdRegistry(await clientFor(ctx)) });
        return 0;
      }
      case 'deploy': {
        const { spawnSync } = await import('node:child_process');
        const rpc = str(args, 'rpc-url');
        const contractsDir = str(args, 'contracts');
        const forgeBin = str(args, 'forge') ?? 'forge';
        const { cmdDeploy } = await loadCommands();
        const doc = await cmdDeploy(
          ctx,
          {
            env: args.env,
            rpcUrl: rpc ?? 'http://127.0.0.1:8545',
            ...(contractsDir !== undefined ? { contractsDir } : {}),
            forgeBin,
          },
          spawnSync,
        );
        render({ kind: 'json', doc: { registryProxy: doc.registryProxy, transactions: doc.transactions.length } });
        return 0;
      }
      case 'completions': {
        const shell = args.positional[0] ?? 'bash';
        if (shell !== 'bash' && shell !== 'zsh' && shell !== 'fish') {
          throw new UsageError('usage: zk completions [bash|zsh|fish]');
        }
        process.stdout.write(completionScript(shell));
        return 0;
      }
      default: {
        const _never: never = args.command;
        throw new Error(`unhandled command: ${_never}`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof UsageError ? 2 : 1;
    process.stderr.write(`zk: ${message}\n`);
    return code;
  }
}

function mainEntry(): void {
  runCli(process.argv.slice(2))
    .then((code) => {
      const finish = (): void => process.exit(code);
      process.stdout.write('', finish);
      process.stderr.write('', finish);
    })
    .catch(errExit);
}

const isEntry = (() => {
    const argv1 = process.argv[1];
    if (argv1 === undefined)
        return false;
    try {
        return /cli\.js$/.test(realpathSync(argv1));
    }
    catch {
        return /cli\.js$/.test(argv1);
    }
})();
if (isEntry) mainEntry();