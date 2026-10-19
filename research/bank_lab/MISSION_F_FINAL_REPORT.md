# Mission F Phase 6/7 -- Deliverables, Verification & Final Bank Lab Report

Date: 2026-10-18
Scope: Mission F synthetic bank-lab deliverables packaging (Phase 6) and empirical verification proof bundle with final closure report (Phase 7).
Status: COMPLETE (44/44 PASS aggregate in Lab Run 3).
Verdict: RELEASE CANDIDATE (Single-Node Verified).

---

## 1. Executive Summary

Mission F established an isolated synthetic bank-lab environment to evaluate and evidence Q-Core platform invariants across financial services workflow analogies. The lab verified cryptographic receipts, replay rejection, tenant isolation, crypto-agility KEK rotation, and transport authentication against four synthetic profile workloads: hsbc, jpmorgan, lgt, and swift.

All 16 hypothesis rows from Mission F Phase 5 (research/REQUIREMENTS_TRACEABILITY.md) were executed in Lab Run 3, achieving an aggregate result of 44 PASS / 0 FAIL across 4 synthetic profiles x 11 adversarial checks.

---

## 2. Phase 6 -- Deliverables Inventory

The Mission F deliverable suite comprises isolated infrastructure definitions, profile configurations, adversarial runners, and teardown runbooks:

| Deliverable | Path | Description |
|---|---|---|
| Synthetic Lab Compose | research/bank_lab/docker-compose.bank-lab.yml | Isolated bridge network (banklab) hosting 4 qcore profile nodes + dev Vault |
| Lab Orchestrator | research/bank_lab/run_bank_lab.sh | Automated build, health gate, adversarial execution, collection, and teardown |
| Adversarial Matrix Runner | research/bank_lab/attacker/adversarial_matrix.py | 11-category adversarial probe suite executing across target nodes |
| Evidence Collector | research/bank_lab/attacker/collect.py | Sanitized JSON evidence extraction and aggregate reporting |
| Teardown Runbook | research/bank_lab/TEARDOWN.md | Clean-state procedure ensuring no residual volumes, networks, or secrets |
| Requirements Traceability | research/REQUIREMENTS_TRACEABILITY.md | Mission F Phase 5 research-to-test mapping (16 public facts to Q-Core tests) |
| Profile Fixtures | research/bank_lab/profiles/ | Synthetic tenant configurations and seeds for HSBC, JPM, LGT, and SWIFT |

---

## 3. Phase 7 -- Verification & Proof Bundle

### 3.1 Lab Run 3 Empirical Results

Execution record: 2026-10-17 UTC, aggregate 44 PASS / 0 FAIL (missing=none).

| Profile | Checks Passed | Seed | Log Evidence Reference |
|---|---|---|---|
| hsbc | 11 / 11 PASS | 753b932a | /tmp/banklab_run3.log:123-134, /tmp/banklab_evidence/hsbc.json |
| jpmorgan | 11 / 11 PASS | 106a1d5b | /tmp/banklab_run3.log:135-146, /tmp/banklab_evidence/jpmorgan.json |
| lgt | 11 / 11 PASS | 83290c5f | /tmp/banklab_run3.log:147-158, /tmp/banklab_evidence/lgt.json |
| swift | 11 / 11 PASS | b7d4828d | /tmp/banklab_run3.log:159-170, /tmp/banklab_evidence/swift.json |

### 3.2 Invariant Verification Summary

1. Bootstrap & Reachability (setup): 200 OK across health, login, org creation, and catalog.
2. Replay & Idempotency (replay_duplicate, concurrent_duplicates):
   - Sequential duplicate submission returns identical alert_id (HTTP 202, idempotent-same).
   - 20-way concurrent race produces exactly 1 identity (20x202 identical, 0x400 conflict).
3. Payload & Evidence Integrity (tamper, malformed_evidence):
   - Byte-flipped signatures fail with HTTP 422; invalid schema fails with HTTP 400.
4. Tenant Isolation (cross_tenant):
   - Cross-tenant validation rejected fail-closed (HTTP 403, mismatch_flag=True).
5. Transport Security (mtls_triple):
   - Verified via live baseline plus Cargo suite backend/control_plane_api/tests/g3_mtls_handshake.rs (trusted accepted, rogue rejected).
6. Key Rotation & Crypto-Agility (vault_rotation):
   - KEK rotated from v1 to v2; ciphertexts differ; both decrypt to original plaintext.
7. Storage Durability (restart_durability):
   - Validated via live consistency plus Cargo suite backend/control_plane_api/tests/g2_durable_idempotency.rs and scripts/durability_backup_restore_drill.sh.

---

## 4. Honest Limitations & Operational Boundaries

1. Synthetic Lab Only: Profile names represent synthetic lab benchmarks, not actual financial institutions. No bank infrastructure was probed or contacted.
2. Single-Node Verified: Multi-node cluster topologies and distributed RAFT remain roadmap items. Production claims are strictly single-node verified.
3. Dev-Vault != Prod HSM: Rotation drill used dev-Vault 1.18. Production deployments require owner-provisioned HSM/KMS.
4. Embedded Policy Engine: Policy evaluation is embedded fail-closed application logic, not a separate external policy daemon.
5. Independent Assurance Gate (G1): Preparation packet complete; independent third-party certification remains uncommissioned. Status stays RELEASE CANDIDATE.

---

## 5. Final Sign-Off

Mission F deliverables and verification criteria are satisfied in full. Codebase, documentation, and test suites are synchronized and ready for push.
