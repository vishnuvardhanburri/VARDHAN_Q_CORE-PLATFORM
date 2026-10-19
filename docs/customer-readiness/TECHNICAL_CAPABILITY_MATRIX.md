# Technical Capability Matrix — Q-Core Platform

> Test-mapping guardrail companion to `docs/CUSTOMER_CLAIMS_MATRIX.md` (Claim IDs C-01..C-14 reused verbatim).
> HEAD `943e61d` (2026-10-17 06:13 IST) · RC `204642c`. Verdict: RELEASE CANDIDATE single-node, NOT PRODUCTION-READY (G1 OPEN).
> Never upgrade evidence strength (UNIT ≠ deployment claim). C-11..C-14 are explicit non-claims.

## Capability → test mapping

| Capability | Module | Test / source | Result | Scope | Integration prerequisite | Unsupported extension |
|---|---|---|---|---|---|---|
| C-01 Tamper detection + rejection | `receipt_api` validate + seal/verify pipeline | `receipt_api` 422/400 paths; lab tamper 4/4 PASS | PASS (ADVERSARIAL-LAB) | Single-node lab; tampered payloads rejected | Customer schema + policy binding; fresh verification run on customer data | Production-security guarantee; assessor verdict (G1 OPEN) |
| C-02 Replay-safe idempotent seal | `is_finding_already_sealed` + `sealed_*.flag` + sled CAS | G2 `g2_durable_idempotency` 4/4; lab replay + 20-way-race PASS | PASS (ADVERSARIAL-LAB) | Single-node sled CAS; duplicates → one record | Single durable path wired; no second writer | Multi-node / failover replay (`ha_cluster` EXPERIMENTAL) |
| C-03 Tenant-bound receipts | Org/tenant binding + authz check | Org-mismatch 403 path; lab `cross_tenant` 403 4/4 | PASS (ADVERSARIAL-LAB) | Lab tenant-pair fixtures | Customer IdP/RBAC binding (owner-provisioned) | Customer identity review substitute; cross-IdP federation |
| C-04 Offline independent re-verification | `vardhan-receipt validate-canonical` + `vardhan_verifier` | G1 packet corpus 72/72 | PASS (CARGO-PROOF) | Pinned canonical corpus at HEAD | Corpus + verifier pinned; re-run per schema version | New schemas / customer data without fresh run |
| C-05 Ed25519 signatures (covered paths) | `license.rs` / `vault.rs` / `anti_tamper.rs` | In-repo unit sign/verify round-trip | PASS (UNIT) | Covered paths only | Deployment key custody decision (customer-owned) | PQC migration; HSM custody; uncovered paths |
| C-06 ML-DSA-87 sign/verify (FIPS 204) | `core_crypto` `ml_dsa_87` | `core_crypto` unit tests | PASS (UNIT) | Algorithm correctness only | None — implementation existence | Certification; audit; quantum-safe deployment |
| C-07 ML-KEM-1024 encap/decap (FIPS 203) | `core_crypto` `MlKem1024` | `core_crypto` unit tests | PASS (UNIT) | Encap/decap round-trip; exchange only | None — implementation existence | Quantum-safe deployment; transport-security; migration claim |
| C-08 mTLS client-auth enforcement | Control-plane verify path (`VARDHAN_TLS_CLIENT_CA_PATH`) | G3 `g3_mtls_handshake` 4/4 + `g3_mtls_proof.sh` | PASS (CARGO-PROOF) | Cargo handshake accept/reject matrix | Prod CA provision + rotation (owner-provisioned) | Lab plaintext baseline is NOT mTLS evidence; prod transport posture |
| C-09 Single-node restart persistence | sled `qcore:event:` CAS (`durable_event_queue.rs`) | G2 restart test | PASS (INTEGRATION) | Single-node restart; CAS authority preserved | Sled volume durable; single writer | Backup/restore; multi-node durability |
| C-10 Vault transit rotation drill | `backend/vardhan_keystore` transit binding | G4 `vault_rotation_drill` PASS + `scripts/g4_vault_rotation_drill.sh` | PASS (INTEGRATION) | DEV Vault 1.18 transit; rotation + recovery | Prod HSM/KMS provision (owner-provisioned) | Prod-HSM evidence; production key custody |
| C-11 Multi-node / HA resilience | `ha_cluster` (EXPERIMENTAL) | None in scope (excluded per G1 packet) | NONE — NO CLAIM | No tested scope | N/A | Entire capability unsupported; must not be represented |
| C-12 Production deployment readiness | Whole platform | PRR §10 BLOCKED; G1 OPEN | NONE — NO CLAIM | No tested scope | G1 commissioned + prod owners assigned | Any deployment-readiness representation |
| C-13 Throughput / latency / soak | N/A | Perf/soak NOT RUN | NONE — NO CLAIM | No tested scope | Measurement plan + harness | Any figure cited |
| C-14 Independent assurance / certification | N/A | G1 packet PREPARATION ONLY; no verdict/certificate | NONE — NO CLAIM | No tested scope | Commissioned assessor | Any certification held |

## Notes

- G2/G3/G4 are CLOSED FOR DEFINED SCOPE (single-node / drill); G1 PREPARED (OPEN, uncommissioned); S-01b CLOSED.
- Lab transport ran `plaintext_http`; mTLS posture rests on G3 cargo proof, not the lab baseline.
- Lab rotation analog ran DEV Vault 1.18 (token `banklab-dev-root`, synthetic plaintext) — drill analog only.
- Prod `backend/*/src/**` identical `204642c`→`943e61d` (`git diff` empty; E-31).

## Per-claim evidence notes (restates table; no new facts)

### C-01 — Tamper detection + rejection
- Test/source: `receipt_api` validate 422/400 paths; lab tamper scenario 4/4 PASS (live).
- Scope: single-node lab; tampered-payload submissions rejected. Prerequisite: customer schema + policy binding.

### C-02 — Replay protection + idempotency
- Test/source: `is_finding_already_sealed` + `sealed_*.flag` + sled CAS; G2 `g2_durable_idempotency` 4/4; lab replay + 20-way-race PASS.
- Scope: single-node CAS path; duplicates resolve to one sealed record. Unsupported: multi-node/failover replay.

### C-03 — Identity + tenant binding
- Test/source: org-mismatch 403 path; lab `cross_tenant` 403 4/4.
- Scope: lab tenant-pair fixtures. Prerequisite: customer IdP/RBAC binding (owner-provisioned).

### C-04 — Signed receipt generation + independent verification
- Test/source: `vardhan-receipt validate-canonical` + `vardhan_verifier` 72/72 per G1 packet.
- Scope: canonical corpus at pinned HEAD. Prerequisite: re-run per schema version / customer dataset.

### C-05 — Ed25519 signatures
- Test/source: `license.rs` / `vault.rs` / `anti_tamper.rs` unit-tested paths (UNIT).
- Scope: sign/verify round-trip on covered paths only. Unsupported: PQC migration, HSM custody, uncovered paths.

### C-06 — ML-DSA-87 (FIPS 204)
- Test/source: `core_crypto` `ml_dsa_87` unit tests (UNIT). Scope: algorithm sign/verify correctness.
- Unsupported: certification, audit, or quantum-safe-deployment claim.

### C-07 — ML-KEM-1024 (FIPS 203)
- Test/source: `core_crypto` `MlKem1024` encap/decap unit tests (UNIT). Scope: key EXCHANGE only.
- Unsupported: quantum-safe deployment, transport-security, or migration claim.

### C-08 — mTLS client-auth
- Test/source: G3 `g3_mtls_handshake` 4/4 + `g3_mtls_proof.sh` (CARGO-PROOF). Scope: cargo handshake matrix.
- Prerequisite: prod CA provision + rotation (owner-provisioned). Lab baseline was `plaintext_http`.

### C-09 — Durable persistence, single node
- Test/source: sled `qcore:event:` CAS (`durable_event_queue.rs`); G2 restart test (INTEGRATION).
- Scope: single-node restart. Unsupported: backup/restore, multi-node durability.

### C-10 — Vault rotation + key custody
- Test/source: `backend/vardhan_keystore` transit binding; G4 `vault_rotation_drill` PASS (INTEGRATION).
- Scope: DEV Vault transit engine. Prerequisite: prod HSM/KMS provision (owner-provisioned).

### C-11 — Multi-node resilience — NO CLAIM
- Evidence: NONE. `ha_cluster` EXPERIMENTAL, excluded per G1 packet. Must not be represented.

### C-12 — Production deployment — NO CLAIM
- Evidence: NONE. PRR §10 BLOCKED; G1 OPEN. Preparation and discovery only.

### C-13 — Performance / throughput — NO CLAIM
- Evidence: NONE. Perf/soak NOT RUN. No figures may be cited.

### C-14 — Certifications / independent assurance — NO CLAIM
- Evidence: NONE. G1 packet PREPARATION ONLY; no verdict, no certificate.

## Explicit unsupported-claims list (must NOT be asserted)

1. C-11: multi-node / HA resilience, RAFT, failover replay — EXPERIMENTAL, no evidence.
2. C-12: production deployment readiness — BLOCKED per PRR §10; G1 OPEN.
3. C-13: any throughput, latency, soak, or capacity figure — NOT RUN, NOT MEASURED.
4. C-14: any certificate, attestation, audit pass, or assessor verdict — NONE held.
5. C-07 phrased as quantum-safe deployment, transport security, or migration completion — exchange implementation only.
6. C-08/C-10 extended to customer CA / HSM / production transport — owner-provisioned, unevidenced.
7. Any bank internal, deficiency, breach, timeline, budget, or procurement-interest assertion — none established.

## Document control

- Owner: platform engineering. Rows upgrade only with a cited passing test or source.
- Sources: `docs/CUSTOMER_CLAIMS_MATRIX.md` · `docs/EVIDENCE_INDEX.md` · `docs/BANK_LAB_RESULTS.md` · `docs/G1_ASSURANCE_PACKET.md`.
