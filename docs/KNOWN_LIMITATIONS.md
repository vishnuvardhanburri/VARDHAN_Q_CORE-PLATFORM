# Known Limitations — Vardhan Q-Core Platform

Status labels used below:
`[IMPLEMENTED-TESTED]` · `[IMPLEMENTED-UNTESTED]` · `[EXPERIMENTAL]` ·
`[SIMULATED]` · `[PLANNED]` · `[UNSUPPORTED]` · `[KNOWN]` · `[UNVERIFIED]`

Base commit: `af241e6` (2026-10-16). CI 9/9 green as verified 2026-10-16 by
Leader — this document does NOT re-verify CI.

> Note on `Q_CORE_ARCHITECTURE.md`: the short (19-line) copy at
> `/Users/vishnuvardhanburri/antigravity/Q_CORE_ARCHITECTURE.md` lives
> OUTSIDE this repo and was NOT edited. It describes a "Single-Seal
> Invariant" in general terms; the multi-node scope of that invariant is
> governed by G2 below (single-node durable path only; multi-node remains
> `[UNSUPPORTED]`). Where the external copy and this document differ, this
> document governs the `af241e6` release.

## Correctness / consistency

| # | Limitation | Status | Detail / pointer |
|---|---|---|---|
| L-01 | Multi-node idempotency (split-brain: in-mem vs durable `qcore:event:` vs file) | `[UNSUPPORTED]` | Gate G2. Single durable path + failover/concurrency test still required. See `docs/SECURITY_FINDINGS_REGISTER.md` S-06, `backend/control_plane_api/src/durable_event_queue.rs`. |
| L-02 | RAFT multi-node consensus | `[EXPERIMENTAL]` | Unit/resilience tests only (`ha_cluster`); no multi-node live deployment evidence. |
| L-03 | Backup / restore procedure | `[IMPLEMENTED-UNTESTED]` | Code/docs path exists; no restore drill evidence at `af241e6`. |
| L-04 | Graceful shutdown | `[IMPLEMENTED-UNTESTED]` | Implemented; orderly-drain behaviour not covered by a dedicated test at `af241e6`. |
| L-05 | Rate-limit effectiveness | `[UNVERIFIED]` | Mechanism present; effectiveness under adversarial load not measured. |

## Security / assurance

| # | Limitation | Status | Detail / pointer |
|---|---|---|---|
| L-06 | Mutual TLS (mTLS) on control-plane / node | `[PLANNED]` | Gate G3. `quantum_node` :8443 TLS example only; no handshake proof. Register S-07. |
| L-07 | HSM / KMS key custody | `[PLANNED]` | Gate G4. Software-only keystore; compose volume `keystore-data`; `lab_keys/` empty. Register S-08. |
| L-08 | Independent pentest / ISO 27001 evidence | `[PLANNED]` | Gate G1. No accredited report at `af241e6`. Register S-11. Cannot assert production security posture. |
| L-09 | Tracked credential + history purge (S-01 / S-01b) | `[KNOWN]` | `scripts/qcore-pov/secrets/admin_password.txt` is UNTRACKED at `af241e6` (removed from index via `git rm --cached` in `af241e6`; present on disk, covered by `.gitignore` `scripts/qcore-pov/secrets/*` + `**/admin_password.txt`; guard `check_no_tracked_secrets.sh` PASSES). History STILL contains secret-bearing blobs (`02707f8` add; `372b69a`/`9b92d49` legacy `.admin_password`) → rotation + filter-repo/BFG purge + force-push coordination STILL OPEN as S-01b. Untracked-and-ignored is NOT rotation, NOT purge, NOT proof of non-exposure. |
| L-10 | Frontend pricing / entities endpoints | `[UNVERIFIED]` (contract) | Frontend lives in a SEPARATE folder (`Vardhan-Q-Core-_-Frontend--main`), not in this backend repo. Pricing/entities endpoints need a provider; contract UNVERIFIED at `af241e6`. |

## Platform / operations

| # | Limitation | Status | Detail / pointer |
|---|---|---|---|
| L-11 | Port 8080 collision | `[KNOWN]` | control-plane + `pq_shield` + receipt-serve + `load_tester` + `verifier` all reference 8080. `qcore doctor` warns; stagger with overrides. See `docs/SERVICE_PORT_REGISTRY.md`. |
| L-12 | eBPF telemetry on macOS | `[SIMULATED]` | Linux-only feature; macOS dev uses simulation path. |
| L-13 | Deployment model | `[KNOWN]` | Single-node Linux (Docker) + macOS dev-sim only at `af241e6`. Multi-region / zero-downtime are roadmap items (README Phase 6), not release claims. |

## Port reference (release snapshot)

8080 (shared — see L-11) · 3000 UI · 9090 mock · 18080 UDP heartbeat ·
18090 raft · 8081 admin · 4318 OTLP · 8443 quantum_node · 18081 HA-test-only.
