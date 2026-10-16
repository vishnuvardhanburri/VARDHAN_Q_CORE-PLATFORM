# Release Manifest — Vardhan Q-Core Platform

| Field | Value |
|---|---|
| Release commit | `af241e6` — "Mission D Phases 0-7: baseline, secret hygiene, backend, frontend API prep, lab harness, CI guardrails, operations, threat model" |
| Repo URL | `https://github.com/vishnuvardhanburri/VARDHAN_Q_CORE-PLATFORM` |
| Manifest date | 2026-10-16 |
| Workspace crates | 33 (per `cargo metadata`, as reported in leader brief) |
| Deployment model | Single-node Linux (Docker) + macOS dev-sim. Multi-node / multi-region NOT in this release. |
| Frontend location | SEPARATE folder (`Vardhan-Q-Core-_-Frontend--main`), not in this backend repo. |
| Published artifacts | None published — provenance `[UNVERIFIED]`. No signed release artifact at this commit. |
| External architecture note | `Q_CORE_ARCHITECTURE.md` (19 lines) exists only at `/Users/vishnuvardhanburri/antigravity/Q_CORE_ARCHITECTURE.md`, outside this repo. NOT edited. Divergences are recorded in `docs/KNOWN_LIMITATIONS.md`, which governs this release. |

## CI — 9/9 green (as verified 2026-10-16 by Leader; NOT re-verified in Phase 8)

The table below reproduces the Leader-verified result. Phase 8 did not
re-run CI and did not touch workflows or source to re-prove it. Workflow
file names are those present at `af241e6`.

| # | Workflow file (at `af241e6`) | Status reported by Leader |
|---|---|---|
| 1 | `ci-correctness-benchmarks.yml` | green (as verified 2026-10-16 by Leader) |
| 2 | `enterprise-release.yml` | green (as verified 2026-10-16 by Leader) |
| 3 | `lab-harness.yml` (lab harness 5/5 PASS) | green (as verified 2026-10-16 by Leader) |
| 4 | `platform-web-contract.yml` | green (as verified 2026-10-16 by Leader) |
| 5 | `platform-web.yml` | green (as verified 2026-10-16 by Leader) |
| 6 | `pov-docker-validation.yml` | green (as verified 2026-10-16 by Leader) |
| 7 | `security.yml` (secret guard PASS, rustls PASS) | green (as verified 2026-10-16 by Leader) |
| 8 | `sovereign-ci.yml` | green (as verified 2026-10-16 by Leader) |
| 9 | `unified-local-runtime.yml` (fmt PASS) | green (as verified 2026-10-16 by Leader) |

Result: **9/9 green, as verified 2026-10-16 by Leader.** Phase 8 adds
documentation only; any future code change invalidates this statement until
CI is re-run.

## Key docs index

| Doc | Purpose |
|---|---|
| `docs/KNOWN_LIMITATIONS.md` (new, Phase 8) | Honest limitation/status labels (L-01…L-13) |
| `docs/SECURITY_FINDINGS_REGISTER.md` | Findings S-01…S-12 + Phase 8 entry; S-01b history purge OPEN |
| `docs/SERVICE_PORT_REGISTRY.md` | Port defaults + 8080 collision rule + `qcore doctor` warns |
| `docs/RELEASE_GATES.md` | Gates G1–G4 (pentest/ISO, idempotency, mTLS, HSM) |
| `docs/OPERATIONS.md` | Single-node run/ops procedure |
| `docs/ROLLBACK_AND_RECOVERY.md` | Rollback/recovery (restore drill UNTESTED — see L-03) |
| `README.md` | Entry point; Runtime/Production Boundary (§280–294) is the claim ceiling |
| `ARCHITECTURE.md` | In-repo architecture reference |

## What this release is NOT

- Not a production-security attestation (G1 pentest/ISO `[PLANNED]`).
- Not multi-node HA (G2 `[UNSUPPORTED]`, RAFT `[EXPERIMENTAL]`).
- Not mTLS-enforced or HSM-backed (G3/G4 `[PLANNED]`).
- No published artifacts; provenance `[UNVERIFIED]`.
