/**
 * Shell completion script generator — bash/zsh/fish. Static scripts that
 * complete the fixed `zk` command surface (commands + flags). Zero deps.
 */

const COMMANDS = ['new', 'prove', 'verify', 'register', 'status', 'registry', 'deploy', 'env', 'completions', 'help'];

function bashScript(): string {
  return `_zk_complete() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local commands="${COMMANDS.join(' ')}"
  local flags="--env --offline --json --help --out --circuit --inputs --file --key --rpc-url --contracts --forge --api-url --client-id --secret --idempotency-key --sign --force"

  if [[ "\${cur}" == -* ]]; then
    COMPREPLY=( $(compgen -W "\${flags}" -- "\${cur}") )
    return 0
  fi

  case "\${prev}" in
    --env) COMPREPLY=( $(compgen -W "dev prod" -- "\${cur}") ); return 0 ;;
    new)
      COMPREPLY=( $(compgen -W "$(zk registry --json 2>/dev/null | sed -n 's/.*"circuitId": *"\\([^"]*\\)".*/\\1/p' | sort -u)" -- "\${cur}") )
      return 0 ;;
  esac

  if [[ "\${COMP_CWORD}" -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    return 0
  fi

  COMPREPLY=( $(compgen -f -- "\${cur}") )
  return 0
}
complete -F _zk_complete zk
`;
}

function zshScript(): string {
  return `#compdef zk
_zk() {
  local -a commands
  commands=(
    'new:scaffold a project (inputs template)'
    'prove:generate a proof envelope (local engine)'
    'verify:verify envelope locally; then API unless --offline'
    'register:anchor a proof on-chain (requires --idempotency-key)'
    'status:on-chain proof status via API'
    'registry:registry info via API'
    'deploy:deploy registry contracts via foundry script'
    'env:manage API profiles'
    'completions:print shell completion scripts'
    'help:this help'
  )
  _arguments -s \
    '--env[profile name]:env:(dev prod)' \
    '--offline[local-only, never call the API]' \
    '--json[machine-readable output]' \
    '--help[show help]' \
    '--out[envelope output file]:file:_files' \
    '--idempotency-key[register idempotency key]:key' \
    '--rpc-url[RPC URL for deploy]:url' \
    '--api-url[API base URL]:url' \\
    '--client-id[API client id]:id' \
    '*: :->args'
  case $words[1] in
    registry) _default ;;
  esac
}
compdef _zk zk
`;
}

function fishScript(): string {
  return `# fish completion for zk
function __zk_commands
  printf '%s\\n' ${COMMANDS.join(' ')}
end

complete -c zk -f
complete -c zk -n '__fish_use_subcommand' -a 'new' -d 'scaffold a project (inputs template)'
complete -c zk -n '__fish_use_subcommand' -a 'prove' -d 'generate a proof envelope (local engine)'
complete -c zk -n '__fish_use_subcommand' -a 'verify' -d 'verify envelope locally and via API'
complete -c zk -n '__fish_use_subcommand' -a 'register' -d 'anchor a proof on-chain'
complete -c zk -n '__fish_use_subcommand' -a 'status' -d 'on-chain proof status via API'
complete -c zk -n '__fish_use_subcommand' -a 'registry' -d 'registry info via API'
complete -c zk -n '__fish_use_subcommand' -a 'deploy' -d 'deploy registry contracts via foundry script'
complete -c zk -n '__fish_use_subcommand' -a 'env' -d 'manage API profiles'
complete -c zk -n '__fish_use_subcommand' -a 'completions' -d 'print shell completion scripts'
complete -c zk -n '__fish_use_subcommand' -a 'help' -d 'show help'
complete -c zk -l env -r -a 'dev prod' -d 'profile name (dev|prod)'
complete -c zk -l offline -d 'never call the API (local-only)'
complete -c zk -l json -d 'machine-readable output'
complete -c zk -l help -d 'show help'
complete -c zk -l out -r -d 'envelope output file'
complete -c zk -l inputs -r -d 'inputs JSON file'
complete -c zk -l file -r -d 'envelope file'
complete -c zk -l idempotency-key -r -d 'idempotency key'
complete -c zk -l rpc-url -r -d 'RPC URL'
`;
}

export type ShellName = 'bash' | 'zsh' | 'fish';

const SHELLS: Record<ShellName, () => string> = { bash: bashScript, zsh: zshScript, fish: fishScript };

export function completionScript(shell: ShellName): string {
  return SHELLS[shell]();
}