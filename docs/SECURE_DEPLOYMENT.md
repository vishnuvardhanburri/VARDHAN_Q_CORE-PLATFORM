# Secure deployment and release controls

**NOT PRODUCTION READY. No live infrastructure changed or release published.**
The production Dockerfile now builds with `--locked` and packages the real `pq_verify`
executable; `vardhan_verifier` is a library and previously caused an invalid COPY target.
A Dockerfile-specific input allowlist excludes runtime files and local credentials
from builder layers while retaining Rust sources and compiled industry contracts.
It already uses UID/GID 10001 and a minimal Debian runtime. Its Rust 1.98 image differs
from the sandbox Rust 1.99.1; image validation is separately recorded in acceptance results.

## Isolated validation path

From a clean checkout with Docker available:

```bash
cargo build --workspace --locked
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked -- --test-threads=1
docker build -f docker/Dockerfile.prod -t qcore-candidate:local .
```

The local development stack uses `./qcore setup` then `./qcore up`; it creates development
configuration and is not the production recipe. See README for the documented local
commands. Never reuse development identity, auth config, keys or data in staging/production.
Staging requires approved synthetic identity provider, database, key service and adapter
configuration. No credential requirement is satisfied with a permissive fallback.

## Production prerequisites (not provisioned)

The receipt executable also requires an approved BLAKE3 `VARDHAN_BINARY_HASH`
in production before CLI parsing; missing hash exits 137. Distribute that reference
through the signed release/configuration process, never derive it from an untrusted
running binary to bypass integrity checks. This is separate from HSM/KMS configuration.

Require non-root, read-only root filesystem, writable dedicated durable volumes,
no-new-privileges, dropped capabilities, CPU/memory/PID limits, private backend networks,
TLS/mTLS, trusted time, external secret custody, key rotation and backup restoration.
Disable dumps and constrain diagnostics; enforce log access/retention and redact payloads.
A health response alone is insufficient: readiness must verify storage, keys, policy,
trust source and execution dependencies. Kubernetes chart rendering, PVC ownership,
ingress trust, policy and rolling upgrade safety still require clean environment tests.
Do not enable multiple replicas without a validated shared transaction authority.

## Release process

Require reviewed PRs and protected main with named security code owners and mandatory
CI. Correctness and release workflows now enforce formatting instead of rewriting source.
Branch protection and code-owner assignments were not changed remotely. Generate SBOM
from the actual locked artifact, validate licenses, scan artifacts/history with redaction,
record builder/base-image digests, sign provenance/artifacts and test rollback. The current
SBOM presence check is not artifact correspondence proof. Existing advisory exceptions
need owner-approved dispositions; this patch adds no vulnerability suppression.

Deploy only after owner approval of the exact immutable artifact/configuration, external
assessment and payment counterparties' acceptance. Roll back binaries only when database,
key epochs and receipts remain compatible. V2 ISO seals and transaction KDF require
coordinated migration; never re-enable the insecure legacy verification fallback.

## Limited container boundary smoke check

After the documented local build, run:

```sh
python3 scripts/security_candidate_image_smoke.py --image qcore-security-candidate:local
```

This checks UID 10001, the offline verifier CLI, refusal of a missing approved
receipt binary hash, and refusal of missing administrator bootstrap identity.
It uses no network, a read-only root, dropped capabilities and disposable tmpfs.
It does not start a configured production service or prove downstream readiness.
The first scratch smoke assertions expected later configuration checks and failed;
the observed startup order was confirmed in source before correcting the assertions.

## Release approval and rollback boundaries

This branch is a hardening candidate, not a versioned production release. Main-branch
protection, required checks and security-owner approval must be verified in GitHub
settings by the repository owner; no settings were changed in this task. Existing
production-environment gates require actual reviewer configuration to enforce approval.

V2 ISO signatures and transaction-derived keys intentionally reject/replace insecure
V1 behavior. Coordinate counterparties and retire affected sessions; a rollback must
stop admission or restore a reviewed compatible implementation. Do not re-enable the
legacy unsigned-version handshake, digest-only seals or generic ACK path. File replay
flags retain their names and exact SEALED bytes; retain them across rollback and
reconcile unknown outcomes before reopening admission. No schema migration, release
publication, signature/provenance publication, infrastructure change or live deployment
was performed here.
