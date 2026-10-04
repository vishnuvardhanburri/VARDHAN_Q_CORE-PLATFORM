# Runtime Tests

## Authoritative CI Checks

GitHub Actions is the source of truth for repository verification. Local or historical test-count documents must not be treated as current evidence unless reproduced by the current workflow run.

Required checks:

- Rust workspace formatting: `cargo fmt --all -- --check`
- Rust workspace build: `cargo build --workspace --release`
- Rust workspace tests: `cargo test --workspace`
- Intelligence Plane typecheck: `npx tsc -p tsconfig.xavira.json --noEmit`
- Intelligence Plane trust-boundary tests: `npx tsx tests/trust_boundary.test.ts`
- Intelligence Plane Vitest suites: `npx vitest run`
- ZK engine build
- Linux eBPF kernel C compilation
- Linux eBPF userspace loader build
- Supply-chain: `cargo audit`
- Supply-chain: `cargo deny check advisories`
- SBOM generation and existence verification
- Secret scanning

## AER-KEP-Q Coverage

- ML-KEM session derivation
- transcript/domain/epoch/message binding
- replay rejection
- descriptor signature verification
- quarantine invalidation
- fresh epoch recovery
- stale epoch rejection
- future epoch rejection
- conflicting same-epoch descriptor rejection
- duplicate descriptor idempotency
- rollback rejection

## Trust Boundary Coverage

The canonical trust boundary contains **22 checks** shared between the TypeScript validation path and the Rust Q Core contract validation path. The canonical implementation and tests are authoritative; this document intentionally does not duplicate historical per-test counts.

## Regression Rule

Existing receipt signing, authority evaluation, ledger formats, transaction state transitions, and Intelligence → Q Core trust-boundary behavior must remain compatible.

All test commands must use the repository's current dependency lockfiles and CI configuration. Do not report historical test totals as current verification.
