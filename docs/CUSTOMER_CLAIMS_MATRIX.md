# Customer Claims Matrix — Q-Core Platform

> Source-of-truth guardrail for all customer conversations. Every proposed claim maps to an existing test or source. Do NOT assert beyond the Tested scope / Limitation columns. G1 packet is PREPARATION ONLY; platform is NOT PRODUCTION-READY (G1 OPEN). No certifications held. No performance figures published.

## Evidence-strength vocabulary

- `UNIT` — Rust unit test in-repo (single module).
- `INTEGRATION` — multi-component test / drill (single-node).
- `ADVERSARIAL-LAB` — live bank-lab adversarial scenario (synthetic data).
- `CARGO-PROOF` — `cargo test` proof script / packet-recorded pass.
- `NONE` — no evidence; claim must NOT be made.

## Claims table

| Claim ID | Proposed claim | Capability/module | Existing test or source | Evidence strength | Tested scope | Limitation | Customer-safe wording |
|---|---|---|---|---|---|---|---|
| C-01 | Tampered receipts are detected and rejected. | `receipt_api` validate path (422/400) + seal/verify pipeline | `receipt_api` validate 422/400 paths; lab tamper scenario 4/4 PASS (live) | ADVERSARIAL-LAB | Single-node lab; tampered-payload submissions rejected with 422/400 | Lab scope only; not a production-security guarantee; assessor verification pending (G1 OPEN) | "In lab testing, tampered receipt submissions were rejected (4/4 PASS); production behaviour requires customer-environment validation." |
| C-02 | Duplicate/replay submissions are deduplicated (idempotent seal). | `is_finding_already_sealed` + `sealed_*.flag` + durable CAS | G2 `g2_durable_idempotency` 4/4; lab replay + 20-way-race PASS | ADVERSARIAL-LAB | Single-node sled CAS path; replay and 20-way concurrent duplicate sealed once | Single-node only; multi-node/failover replay outside tested scope (`ha_cluster` EXPERIMENTAL) | "In single-node lab tests, replays and concurrent duplicates resolved to a single sealed record; multi-node replay handling is not evidenced." |
| C-03 | Receipts are bound to tenant identity; cross-tenant access is denied. | Org/tenant binding + authz check | Org-mismatch 403 path; lab `cross_tenant` 403 4/4 | ADVERSARIAL-LAB | Lab tenant-pair; mismatched-org reads/writes denied with 403 | Lab tenant fixtures only; not a substitute for customer IdP/RBAC review | "In lab tests, cross-tenant submissions were denied (403, 4/4); customer identity integration remains owner-provisioned." |
| C-04 | Sealed receipts can be independently re-verified offline. | `vardhan-receipt validate-canonical` + `vardhan_verifier` | G1 packet: `vardhan_verifier` 72/72 | CARGO-PROOF | Canonical receipt corpus at pinned HEAD; deterministic re-verification | Corpus-bound; new schema versions or customer data require re-verification | "A pinned receipt corpus re-verified 72/72 with the independent verifier; customer data would need its own verification run." |
| C-05 | Seals use Ed25519 signatures on tested paths. | `license.rs` / `vault.rs` / `anti_tamper.rs` | In-repo unit-tested signature paths | UNIT | Unit scope: sign/verify round-trip on covered paths | Unit scope only; PQC migration and HSM custody are separate, unevidenced topics | "Covered code paths sign and verify with Ed25519 in unit tests; deployment key custody is a separate customer-owned decision." |
| C-06 | ML-DSA-87 (FIPS 204) sign/verify is implemented. | `core_crypto` `ml_dsa_87` | `core_crypto` ML-DSA-87 unit tests | UNIT | Unit scope: algorithm sign/verify correctness | Implementation existence only; NOT a certified, audited, or quantum-safe-deployment claim | "ML-DSA-87 sign/verify is unit-tested at implementation level; this is not a certification or deployment-readiness claim." |
| C-07 | ML-KEM-1024 (FIPS 203) key exchange is implemented. | `core_crypto` `MlKem1024` | `core_crypto` MlKem1024 encap/decap unit tests | UNIT | Unit scope: encap/decap round-trip (key EXCHANGE only) | Key exchange only; NOT a quantum-safe-deployment, transport-security, or migration claim | "ML-KEM-1024 encapsulation is unit-tested for key exchange; this does not establish any quantum-safe deployment." |
| C-08 | Control-plane enforces mTLS client authentication. | Control-plane mTLS verify path | G3 `g3_mtls_handshake` 4/4 + `g3_mtls_proof.sh` | CARGO-PROOF | Cargo test scope: handshake accept/reject matrix | Lab transport was `plaintext_http`; production CA/rotation is owner-provisioned and unevidenced | "Cargo tests evidenced mTLS client-auth accept/reject (4/4); lab transport ran plaintext and production CA remains customer-provisioned." |
| C-09 | Sealed-event queue persists across single-node restart. | sled `qcore:event:` CAS queue (`durable_event_queue.rs`) | G2 restart test | INTEGRATION | Single-node restart; CAS authority preserved | Single node only; backup/restore and multi-node durability untested | "Single-node restart testing showed the durable queue preserved sealed events; resilience beyond one node is not evidenced." |
| C-10 | Vault transit keys rotate with a recovery drill. | `backend/vardhan_keystore` transit binding | G4 `vault_rotation_drill` PASS | INTEGRATION | DEV Vault transit engine; rotation + recovery drill | DEV Vault only; production HSM/KMS is owner-provisioned and unevidenced | "Rotation and recovery were drilled against DEV Vault; production key custody (HSM/KMS) remains a customer-owned decision." |
| C-11 | Multi-node / HA resilience. | `ha_cluster` (EXPERIMENTAL) | None in scope (excluded per G1 packet) | NONE | No tested scope | NO customer claim permitted; RAFT/experimental paths excluded | "Multi-node resilience is experimental and must not be represented as a capability." |
| C-12 | Production deployment readiness. | Whole platform | `docs/PRODUCTION_READINESS_REPORT.md` §10 BLOCKED; G1 OPEN | NONE | No tested scope | NOT PRODUCTION-READY; assessor re-verification required | "The platform is not production-ready; any deployment discussion is preparation and discovery only." |
| C-13 | Throughput / latency / soak performance. | N/A | Perf/soak NOT RUN | NONE | No tested scope | NOT MEASURED; no figures may be cited | "Performance has not been measured; no throughput or latency figures are offered." |
| C-14 | Independent assurance / certification. | N/A | G1 packet is PREPARATION ONLY; no assessor verdict, no certificate | NONE | No tested scope | NONE held; packet aids a future assessment only | "No independent assurance or certification is held; the G1 packet is preparation material for a future assessment." |

## Rules

1. Cite `Claim ID` + test/file in every customer statement; never upgrade vocabulary (e.g. UNIT → production guarantee).
2. C-11..C-14 are explicit non-claims; if asked, answer "not evidenced / not production-ready" and offer a lab-discovery next step.
3. ML-KEM (C-07) is key-exchange implementation only; never phrase as quantum-safe deployment.
4. mTLS (C-08), Vault (C-10), persistence (C-09) always ship with their Limitation sentence.

## Per-claim evidence notes (restates table; no new facts)

### C-01 — Tamper detection + rejection
- Evidence: `receipt_api` validate 422/400 paths; lab tamper scenario 4/4 PASS (live).
- Tested scope: single-node lab; tampered-payload submissions rejected.
- Limitation: lab scope only; not a production-security guarantee; G1 OPEN.

### C-02 — Replay protection + idempotency
- Evidence: `is_finding_already_sealed` + `sealed_*.flag` + sled CAS; G2 `g2_durable_idempotency` 4/4; lab replay + 20-way-race PASS.
- Tested scope: single-node CAS path; duplicates resolved to a single sealed record.
- Limitation: single-node only; multi-node/failover replay unevidenced (`ha_cluster` EXPERIMENTAL).

### C-03 — Identity + tenant binding
- Evidence: org-mismatch 403 path; lab `cross_tenant` 403 4/4.
- Tested scope: lab tenant-pair; mismatched-org access denied.
- Limitation: lab fixtures only; customer IdP/RBAC review still required.

### C-04 — Signed receipt generation + independent verification
- Evidence: `vardhan-receipt validate-canonical` + `vardhan_verifier` 72/72 per G1 packet.
- Tested scope: canonical receipt corpus at pinned HEAD; deterministic re-verification.
- Limitation: corpus-bound; new schemas or customer data need a fresh run.

### C-05 — Ed25519 signatures
- Evidence: `license.rs` / `vault.rs` / `anti_tamper.rs` unit-tested paths.
- Tested scope: sign/verify round-trip on covered paths (UNIT).
- Limitation: unit scope only; PQC migration and HSM custody are separate topics.

### C-06 — ML-DSA-87 (FIPS 204)
- Evidence: `core_crypto` `ml_dsa_87` unit tests (UNIT).
- Tested scope: algorithm sign/verify correctness.
- Limitation: implementation existence only; NOT a certification or deployment claim.

### C-07 — ML-KEM-1024 (FIPS 203)
- Evidence: `core_crypto` `MlKem1024` encap/decap unit tests (UNIT).
- Tested scope: encap/decap round-trip; key EXCHANGE only.
- Limitation: NOT a quantum-safe-deployment, transport-security, or migration claim.

### C-08 — mTLS client-auth
- Evidence: G3 `g3_mtls_handshake` 4/4 + `g3_mtls_proof.sh` (CARGO-PROOF).
- Tested scope: cargo-test handshake accept/reject matrix.
- Limitation: lab transport was `plaintext_http`; production CA owner-provisioned.

### C-09 — Durable persistence, single node
- Evidence: sled `qcore:event:` CAS (`durable_event_queue.rs`); G2 restart test (INTEGRATION).
- Tested scope: single-node restart; CAS authority preserved.
- Limitation: single node only; backup/restore and multi-node durability untested.

### C-10 — Vault rotation + key custody
- Evidence: `backend/vardhan_keystore` transit binding; G4 `vault_rotation_drill` PASS (INTEGRATION).
- Tested scope: DEV Vault transit engine; rotation + recovery drill.
- Limitation: DEV Vault only; production HSM/KMS owner-provisioned.

### C-11 — Multi-node resilience — NO CLAIM
- Evidence: NONE. `ha_cluster` is EXPERIMENTAL and excluded per G1 packet.
- Customer-safe wording: "Multi-node resilience is experimental and must not be represented as a capability."

### C-12 — Production deployment — NO CLAIM
- Evidence: NONE. `docs/PRODUCTION_READINESS_REPORT.md` §10 BLOCKED; G1 OPEN.
- Customer-safe wording: "The platform is not production-ready; any deployment discussion is preparation and discovery only."

### C-13 — Performance / throughput — NO CLAIM
- Evidence: NONE. Perf/soak NOT RUN; nothing measured.
- Customer-safe wording: "Performance has not been measured; no throughput or latency figures are offered."

### C-14 — Certifications / independent assurance — NO CLAIM
- Evidence: NONE. G1 packet is PREPARATION ONLY; no assessor verdict, no certificate.
- Customer-safe wording: "No independent assurance or certification is held; the G1 packet prepares a future assessment."

## Document control

- Owner: platform engineering. Review on any G1/G2/G3/G4 evidence change or HEAD move.
- Status: living guardrail; rows may only be upgraded with a cited passing test or source.
- Out of scope: all non-`docs/` changes; no code, config, or key material touched.
