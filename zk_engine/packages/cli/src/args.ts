/**
 * CLI argument parsing — hand-rolled, no deps, typed, unit-tested.
 * Command surface mirrors the M6 roadmap: `new`, `prove`, `verify`,
 * `register`, `status`, `registry`, `deploy`, `env`, plus `--help` and
 * a global `--env dev|prod` profile selector.
 */

export type Command =
  | 'new'
  | 'prove'
  | 'verify'
  | 'register'
  | 'status'
  | 'registry'
  | 'deploy'
  | 'env'
  | 'completions'
  | 'help';

export interface ParsedArgs {
  command: Command;
  env: string;
  flags: Record<string, string | boolean>;
  positional: string[];
}

const COMMANDS: readonly Command[] = [
  'new',
  'prove',
  'verify',
  'register',
  'status',
  'registry',
  'deploy',
  'env',
  'completions',
];
const BOOL_FLAGS = new Set(['--help', '--offline', '--sign', '--json', '--force']);
const STR_FLAGS = new Set([
  '--env',
  '--circuit',
  '--inputs',
  '--out',
  '--file',
  '--key',
  '--rpc-url',
  '--contracts',
  '--forge',
  '--api-url',
  '--client-id',
  '--secret',
  '--idempotency-key',
]);

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    return { command: 'help', env: 'dev', flags: { help: true }, positional: [] };
  }
  const raw = argv[0]!;
  if (!COMMANDS.includes(raw as Command)) {
    throw new UsageError(`unknown command "${raw}" — run \`zk --help\``);
  }
  const command = raw as Command;
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--env') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new UsageError('--env requires a value (dev|prod)');
      flags.env = value;
      i++;
      continue;
    }
    if (BOOL_FLAGS.has(arg)) {
      flags[arg.slice(2)] = true;
      continue;
    }
    if (STR_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new UsageError(`${arg} requires a value`);
      flags[arg.slice(2)] = value;
      i++;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new UsageError(`unknown flag "${arg}"`);
    }
    positional.push(arg);
    continue;
  }
  // Expressed / implicit profile defaults
  const env = typeof flags.env === 'string' ? flags.env : 'dev';
  return { command, env, flags, positional };
}