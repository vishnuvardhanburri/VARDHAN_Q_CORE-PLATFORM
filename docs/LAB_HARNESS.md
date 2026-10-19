# Lab Harness — Canonical Verification (`lab_demo_verify.sh`)

The canonical lab harness is **`lab_demo_verify.sh`** at the repository root of
`VARDHAN_Q_CORE-PLATFORM-main`. It is the single source of truth for the
controlled lab demonstration: five checks against the **REAL**
`vardhan-receipt` binary. There is exactly one authoritative copy — this one.

## Canonical command

From a clean checkout, with the release binary built:

```bash
cargo build --release -p vardhan_receipt
./lab_demo_verify.sh
# or equivalently:
bash lab_demo_verify.sh
```

Prerequisites:

- Rust toolchain with the workspace package `vardhan_receipt`
  (`cargo build --release -p vardhan_receipt` produces
  `target/release/vardhan-receipt`).
- `python3` (required — JSON-aware assertions; the harness exits 2 without it).
- `jq` (optional — warn-not-fail if missing; `grep` + `python3` carry the
  assertions).
- `bash`, standard POSIX tools (`sed`, `mktemp`, `grep`, `uname`).

## What it checks (all REAL)

| # | Name | Expectation |
|---|------|-------------|
| 1/5 | `seal-valid` | A valid, authorized finding seals (`SEALED`). |
| 2/5 | `replay-protection` | Re-sealing the same finding is rejected (`REJECTED_REPLAY`). |
| 3/5 | `trust-boundary` | A malformed evidence hash is rejected (`REJECTED_TRUST_BOUNDARY`). |
| 4/5 | `tamper-rejection` | A tampered `ed25519_sig` fails independent `verify` (`"Invalid"`). |
| 5/5 | `authz-rejection` | An unauthorized identity is rejected (`DENY` or `REJECTED`). |

Receipt seal / verify / replay / trust-boundary / authz checks always run
**REAL** — they exercise the receipt crypto and policy paths and do not need
XDP. Assertions are dual-signal: `grep` plus an independent `python3` JSON
parse, and both must agree (falls back to `grep` alone with a `[NOTE]` only if
`python3` were missing — but `python3` is a hard prerequisite, so in practice
both always run).

## Environment overrides

| Variable | Default | Purpose |
|----------|---------|---------|
| `RECEIPT_BIN` | `${REPO_ROOT}/target/release/vardhan-receipt` | Path to the receipt binary under test. |
| `VARDHAN_ENV` | `development` | Runtime environment label. |
| `VARDHAN_KEYSTORE_DIR` | `${TEMP_DB_DIR}/keys` | Isolated keystore dir (fresh temp dir per run). |
| `VARDHAN_IDEMPOTENCY_DIR` | `${TEMP_DB_DIR}/idempotency` | Isolated idempotency store (fresh temp dir per run). |
| `VARDHAN_AUTH_CONFIG_PATH` | `${VARDHAN_KEYSTORE_DIR}/auth_config.json` | Authorization config path. |
| `VARDHAN_ENFORCE_MODE` | `sim` | `real` is honoured **only on Linux with explicit opt-in**; anywhere else the harness forces `sim`. |

Each run uses an isolated `mktemp -d` workspace guarded by
`trap 'rm -rf "${TEMP_DB_DIR:-}"' EXIT INT TERM`, plus explicit idempotent
cleanups at each failure site and at the end.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | All checks passed. |
| `1` | One or more checks FAILED. |
| `2` | Prerequisites missing (binary not found / not executable, `python3` missing). |

## Result semantics

Each check is prefixed `[CHECK n/5 name]`; result lines use:

- `[PASS]` — a REAL check passed (receipt crypto path).
- `[FAIL]` — a REAL check failed (exit 1).
- `[SKIP]` — check skipped, with a reason (reserved; none skipped today).
- `[SIMULATED]` — placeholder only, never a substitute for receipt checks.
- A final `SUMMARY: PASS=… FAIL=… SKIP=… SIMULATED=…` block is always printed.

## macOS note

eBPF/XDP enforcement is **unavailable on macOS** (`Darwin`). On any non-Linux
OS the harness prints:

```text
NOTICE: eBPF/XDP enforcement unavailable on <OS>/<ARCH> — traffic-enforcement checks run as SIMULATED, receipt crypto checks remain REAL
```

and forces `ENFORCE_MODE=sim`. The five receipt checks remain REAL on macOS.
On Linux, `real` enforcement requires explicit opt-in
(`VARDHAN_ENFORCE_MODE=real`); otherwise `sim` is used there as well.

## Root-copy deprecation notice

The copy at the filesystem root — `/antigravity/lab_demo_verify.sh` — is a
**FROZEN reference**. Do not use it and do not edit it: it lacks temp-dir
isolation safeguards, structured output, prerequisite checks, OS/capability
detection, and honest SIMULATED vs PASS semantics. The canonical harness is
**`VARDHAN_Q_CORE-PLATFORM-main/lab_demo_verify.sh`**. Any future change goes
there.
