# Vardhan Post-Quantum Ingress Engine: GitHub Issues & Roadmap

This document defines the formal GitHub Issues tracker for the Vardhan Quantum Proxy engineering roadmap.

---

## 🟢 Completed & Frozen Milestones (Ready to Tag / Close)

### Issue #1: [P1 FREEZE] Non-Blocking Telemetry Engine & Live SSE Replay
* **Labels:** `telemetry`, `frozen`, `p1`
* **Status:** CLOSED (Commit `4073fe7`)
* **Description:**
  - Non-blocking crossbeam channel decoupling telemetry from data plane.
  - Snapshot gauge `requests_per_sec` driven by completed upstream requests.
  - Monotonic `successful_handshakes`, `upstream_failures`, and `frames_rejected_total` counters.
  - SSE circular replay buffer with explicit `HTTP 410 Gone` expired sequence handling.
  - Bearer token authentication and CORS header validation.

### Issue #2: [P2 FREEZE] Durable BLAKE3 Audit Ledger & ML-DSA-87 Verifier
* **Labels:** `security`, `audit`, `fips204`, `frozen`, `p2`
* **Status:** CLOSED (Commit `4073fe7`)
* **Description:**
  - Append-only write-ahead log (`audit_ledger` crate) with BLAKE3 Merkle chain.
  - FIPS 204 ML-DSA-87 digital signatures per entry.
  - Crash-safe torn write truncation and continuous recovery.
  - Standalone offline verification tool (`pq_verify`) validating sequence, chain hash, and signature.
  - Complete acceptance test harness (`p2_verify_gate.sh`) validating tampered bundle rejection.

### Issue #3: [P3.1 FREEZE] OpenTelemetry Tracing & Typed Prometheus Observability
* **Labels:** `observability`, `opentelemetry`, `prometheus`, `frozen`, `p3`
* **Status:** CLOSED (Commit `4073fe7`)
* **Description:**
  - Integrated `opentelemetry = "0.32"`, `opentelemetry-otlp`, and `tracing-opentelemetry = "0.33"`.
  - OTLP HTTP trace export for `session.handshake` and `proxy.forward` spans with attributes.
  - Typed Prometheus registry (`proxy_requests_total`, `proxy_request_duration_seconds`, etc.).
  - Retained backward-compatible JSON `/api/v1/metrics` format.
  - Sustained load test: 79.2k+ req/sec, 0 errors, 7µs p50 latency.

### Issue #4: [P3.3 FREEZE] KMS/HSM-Backed Key Protection & Zeroizing DEK
* **Labels:** `kms`, `hsm`, `security`, `frozen`, `p3`
* **Status:** CLOSED (Commit `4073fe7`)
* **Description:**
  - Extended `KeyProtector` trait with envelope encryption v2 (`wrapped_dek`).
  - Ephemeral 256-bit DEK generated per envelope, securely scrubbed via `zeroize::Zeroizing`.
  - AWS KMS adapter with multi-version key history and automatic key rotation support.
  - PKCS#11 hardware module adapter (`HsmKeyProtector`).
  - Production guardrail: immediately exits if `VARDHAN_ENV=production` and `local-dev` is configured.
  - Fail-fast on KMS outage (HTTP 503) and IAM AccessDenied.
  - Acceptance gate: 80,040 req/sec sustained post-quantum traffic through KMS-unwrapped proxy.

---

## 🟡 Open Roadmap Issues (Upcoming Implementation)

### Issue #5: [P3.4] High Availability & Multi-Node Gateway Cluster
* **Labels:** `clustering`, `high-availability`, `p3`
* **Status:** OPEN (Next Up)
* **Description:**
  - Multi-node cluster membership and peer discovery.
  - Distributed heartbeat protocol and node health checking.
  - Active-active and active-passive failover mechanisms.
  - Graceful session migration and draining during rolling upgrades.

### Issue #6: [P3.5] Distributed Multi-Node Telemetry & Cluster Aggregation
* **Labels:** `telemetry`, `observability`, `p3`
* **Status:** OPEN
* **Description:**
  - Aggregation of cluster-wide post-quantum metrics across edge nodes.
  - Distributed Shannon entropy monitoring across geographic regions.
  - Federated Prometheus scraping endpoint for multi-node deployments.

### Issue #7: [P3.6] Kubernetes Production Hardening & Cloud-Native Packaging
* **Labels:** `kubernetes`, `devops`, `helm`, `p3`
* **Status:** OPEN
* **Description:**
  - Production Helm charts with configurable KMS/HSM secret providers.
  - Distroless minimal container images with non-root security context.
  - Readiness and liveness probes hooked into gateway cryptographic health.
  - PodDisruptionBudgets and horizontal pod autoscaling metrics.

### Issue #8: [P3.7] Security Validation & Fuzzing Harness
* **Labels:** `security`, `fuzzing`, `testing`, `p3`
* **Status:** OPEN
* **Description:**
  - Differential fuzzing on ML-KEM-1024 decapsulation and ML-DSA-87 signature verification.
  - Constant-time verification against timing side-channel attacks.
  - Automated cryptographic fault injection in CI pipeline.

### Issue #9: [P3.8] Reproducible Performance Benchmarking & Kernel Bypass
* **Labels:** `performance`, `ebpf`, `benchmarking`, `p3`
* **Status:** OPEN
* **Description:**
  - Automated soak testing for 24h+ memory leak detection.
  - Kernel bypass exploration (eBPF / AF_XDP Zero-Copy) for 10M+ req/sec dark pool latency.
  - Standardized microbenchmark harness comparing ML-KEM NTT implementations.

---

## 🔒 P6-HARDENING: Distributed Consensus Safety Gate (MANDATORY before P7)

### Issue #10: [P6-HARDENING GATE] Raft split-brain safety & write-path hardening
* **Labels:** `consensus`, `raft`, `security`, `p6-hardening`, `critical`
* **Status:** FROZEN / COMPLETE — All P6 hardening criteria met. P7 development begins.
* **Blocking:** P7 (Security Production Readiness)
* **Description:**
  - **SEC-RAFT-SPLITBRAIN-004 (FIXED):** TOCTOU race in `start_election()` caused both surviving nodes to become Leader at the same term after leader kill. Fixed with atomic re-check of `current_term` and `role` under write locks before `LEADER_TRANSITION`. Verified by 20-iteration TCP adversarial election race test (0 split-brain events).
  - **SEC-RAFT-SAFETY-001 (VERIFIED):** At most one leader per term invariant holds in real TCP cluster. Verified by adversarial test.
  - **SEC-RAFT-SAFETY-002 (OPEN → P7):** Write-path leadership gating — pq_shield proxy does not enforce leader-only writes at connection level. Tracks SEC-AUTH-RELAYOUT-003.
  - **SEC-RAFT-SAFETY-003 (VERIFIED — L3):** Stale-leader write rejection — stale leader steps down on receiving higher-term AppendEntries. Verified by `test_old_leader_returns_fencing` Rust L3 test.
  - **RPC timeout hardening:** Reduced `send_request_vote`/`send_append_entries` response timeout from 2s → 500ms and TCP connect timeout from 5s → 1s to enable faster leader failover.
  - **Prerequisite:** Must pass 20-iteration adversarial TCP election race test BEFORE P7 milestone can begin.

### Resolution Criteria (All Required for P6 Freeze → P7)
- [x] SEC-RAFT-SPLITBRAIN-004 fix applied (atomic re-check in `start_election()`)
- [x] 20-iteration adversarial TCP election race: 0 split-brain events (20/20 success)
- [x] All 16 Rust L3 tests pass (raft_l3_validation 1/1, raft_l3_replication 11/11, raft_l3_failure 14/14, raft_l3_1_hardening 12/12)
- [x] P7.1: Write-path fencing implemented in pq_shield accept loop
- [x] P7.1: 12-test adversarial TCP matrix (W1-W12) — all pass
- [x] P7.2: Leadership re-check after handshake (closes check→stepdown→write race)
- [x] P7.2: 12,892-probe adversarial race test — 0 stale writes forwarded
- [x] SEC-EVIDENCE-002 (signed checkpoints) — P7.3: 27/27 tests pass, 62/62 total

---

## 🟡 P7: Application Write-Path Fencing & Ledger Evidence

### Issue #11: [P7.1] Application Write-Path Fencing (SEC-AUTH-RELAYOUT-003 / SEC-RAFT-SAFETY-002)
* **Labels:** `consensus`, `raft`, `security`, `p7`, `write-path-fencing`
* **Status:** IN PROGRESS — Implementation complete, adversarial TCP tests pass
* **Description:**
  - Add `RaftRole::Leader` check in `pq_shield` `run_interceptor_loop()` accept loop.
  - Non-leader nodes return HTTP 503 with `X-Raft-Not-Leader` and `X-Raft-Leader-Id` headers.
  - New `RaftNode::is_leader()` and `role_snapshot()` methods in `raft.rs`.
  - Adversarial TCP test matrix (W1-W12): follower rejects, leader accepts, stale leader
    after stepdown rejects, rejoined node remains fenced.
  - **Resolution Criteria:** All 12 adversarial TCP tests pass.

### Issue #12: [P7.2] Adversarial Stale-Leader Race Testing
* **Labels:** `consensus`, `raft`, `security`, `p7`, `stale-leader`
* **Status:** IN PROGRESS — Fix applied, race test verified (12,892 probes, 0 stale writes forwarded)
* **Description:**
  - The race window: `is_leader()` check at accept time → PQ handshake in progress →
    node receives higher-term AppendEntries and steps down → handshake completes →
    data forwarded to upstream from a non-leader.
  - Fix: `pq_shield/src/lib.rs` re-checks `raft_node.is_leader()` AFTER the PQ
    handshake completes, before connecting to upstream. If the node stepped down,
    the connection is rejected with HTTP 503.
  - Adversarial test: 12,892 continuous probes at 0.5ms intervals to leader, kill
    leader mid-stream, 8s observation window.
  - **Results:** 0 actual stale writes forwarded, 0 follower write bypasses,
    1 kernel-level SYN-ACK race (TCP accepted before SIGKILL, 0 data forwarded).
  - **Resolution Criteria:** `accepted_by_follower == 0`, `authoritative_stale_writes == 0`,
    `writes_after_confirmed_stepdown == 0`, `new_leader writes > 0`.

### Issue #13: [P7.3] Raft-Committed Ledger Checkpoints (SEC-EVIDENCE-002)
* **Labels:** `consensus`, `raft`, `ledger`, `security`, `p7`, `evidence`
* **Status:** COMPLETE — IMPLEMENTED & VALIDATED
* **Test Results:** 27/27 adversarial + regression tests pass; 62/62 total P7+L3 tests
* **Description:**
  - Bind ledger checkpoints to Raft committed log index.
  - Sign checkpoints with ML-DSA-87 including: cluster_id, configuration_epoch,
    raft_term, raft_log_index, ledger_start_seq, ledger_end_seq, merkle_root,
    previous_checkpoint_hash, timestamp.
  - Move from "local hash chain valid" to "committed by Raft quorum."
  - Three bugs discovered and fixed during adversarial testing:
    1. Non-deterministic Merkle root (node-local timestamps) → fixed with BLAKE3(seq || entry_data)
    2. Ledger sequence vs Raft log index divergence → fixed by using ledger_seq as block index
    3. Idempotency check fall-through → fixed with explicit `continue`

---

## 💡 Note on GitHub PAT Permissions
To sync these issues directly to the GitHub Issues tab using GitHub CLI:
1. Navigate to: **GitHub -> Settings -> Developer Settings -> Personal Access Tokens**
2. In the permissions for your token (`github_pat_11BOGJ...`), enable:
   - **Repository permissions -> Issues:** `Read and Write`
3. Run the sync command: `gh issue create`
