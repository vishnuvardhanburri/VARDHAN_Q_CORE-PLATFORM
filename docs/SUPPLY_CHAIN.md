# Supply-Chain Policy

## Lockfile policy

- `Cargo.lock` is committed at the repository root and enforced in CI.
  Do not delete it, do not add it to `.gitignore`, and do not accept PRs
  that remove or truncate it.
- JavaScript lockfiles are committed (`package-lock.json` at the root,
  `sdk/typescript/`, `zk_engine/`, and `intelligence_plane/`). There is
  currently no `pnpm-lock.yaml` in the tree; if the project migrates to
  pnpm, the pnpm lockfile must be committed under the same rule.
- Dependabot/Renovate-style lockfile-only updates are allowed, but any
  lockfile change must still pass the full `security.yml` gates below.

## CI gates (`.github/workflows/security.yml`)

All gates are fail-closed — no `|| true`, no `continue-on-error`:

1. `cargo install cargo-audit --locked` + `cargo install cargo-deny --locked`
   (pinned tooling installs).
2. `python3 scripts/check_rustls_lock.py` — enforces the patched rustls
   0.23 release floor (`MIN_PATCH = 46`); legacy `0.21.12` retained only
   via the opt-in AWS KMS SDK graph and reported in the audit exception
   policy.
3. `cargo audit` — RustSec advisory scan.
4. `cargo deny check advisories` — advisory/ban check per `deny.toml`
   and `.cargo/audit.toml`.
5. Inline repository secret scan (`git grep` for `AKIA…` / private-key
   headers).
6. `bash scripts/check_no_tracked_secrets.sh` — tracked
   secret-adjacent file guard (`*/admin_password.txt`, `.admin_password`,
   `lab_keys/*`, `*.pem`, `*.key`; `README.md` / `.gitkeep` placeholders
   allow-listed). Exit 1 on any tracked match.

## `check_rustls_lock` floor

- Script: `scripts/check_rustls_lock.py`.
- Reads root `Cargo.lock`, collects every `rustls` package version, and
  fails CI if the maintained 0.23 line regresses below the October 2026
  fix. Run locally with `python3 scripts/check_rustls_lock.py`.

## Secret guard

- Script: `scripts/check_no_tracked_secrets.sh` (read-only; `git ls-files`
  only, never modifies the index/worktree).
- Run locally with `bash scripts/check_no_tracked_secrets.sh`.
- A FAIL verdict requires a rotation + purge decision; see
  `docs/SECURITY_FINDINGS_REGISTER.md`.

## Provenance

- No artifact signing or SLSA provenance is configured yet.
- Supply-chain provenance status: **UNVERIFIED** until signing/provenance
  is added (follow-up).
