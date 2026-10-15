# Limitations and Remediation

## Document Status

**Purpose:** Capture known limitations of the PoV test environment and provide remediation guidance for production deployment.

**Original report date field:** 2025-10-15 (the actual execution date is not independently confirmed)  
**Original Git HEAD:** `8d403fe551d388a79a7b88e855c987825c4d9985`  
**Follow-up audit:** 2026-10-15 — corrected harness changes are on a follow-up branch; a fresh run is pending.

---

## 0. Follow-Up Evidence Audit (2026-10-15)

The initial PoV evidence pack needs a corrected rerun before buyer-facing use:

- The acceptance matrix lists AC-01 through AC-28 (28 criteria), although the summary said 26/26.
- The original performance script used 50 total requests for requested concurrency 100 and 20 requests for the E2E concurrency-50 case. These cannot validate the named concurrency levels.
- Throughput numbers in the first report were inferred from nominal concurrency and median latency rather than measured from wall-clock completion rate. Those throughput figures are withdrawn.
- The original session-backed benchmark performed worker-0 warm-up while other workers could already be in the measured phase. The corrected script warms sessions before timing and records run duration, throughput, and observed concurrency.
- The original S15 script did not assert the claimed one-SEALED/four-REJECTED_REPLAY distribution. The corrected check asserts the exact distribution, and the corrected security run is pending.
- The original one-command runner suppressed the exit statuses of security and benchmark processes. The corrected runner records those failures and exits non-zero if a suite process fails. The performance script also exits non-zero when measured requests or warm-up operations fail.
- The first report's displayed c1 medians (7.178 ms HTTP and 6.627 ms direct CLI) differ by 0.551 ms, not ~1.5 ms. Even 0.551 ms is only a difference between separate runs, not a definitive paired measurement of HTTP overhead.
- The earlier phrase “Logistics Gateway Trust” was an invented expansion for LGT and is withdrawn. The scenario and its hostnames are synthetic; no LGT-specific requirements or problem have been validated.
- The revised runner captures host/container environment metadata and samples Docker CPU/memory/network/block I/O/PIDs once per second. The first run did not capture these resource measurements.

**Current evidence classification:** first-run results are provisional; corrected execution, raw artifact review, and CI validation remain required. See the updated acceptance matrix, performance benchmark report, security results, and decision report.

---

## 1. Idempotency Store: File-Based, Not Distributed

### Limitation
The idempotency store uses local filesystem flag files (`O_CREAT | O_EXCL`) at `$VARDHAN_IDEMPOTENCY_DIR`. This provides crash-safe replay protection within a single node, but does not protect against concurrent submissions to **different** nodes (horizontal scaling).

### Impact
In a multi-node deployment, two different control plane instances could process the same `finding_id` simultaneously, resulting in duplicate sealing.

### Remediation
Replace the file-based idempotency store with a distributed coordination layer:
- **Redis** with `SET key value NX EX` (atomic check-and-set with TTL)
- **Raft-consensus log** (VARDHAN Q-Core already has a `ha_cluster` module with Raft implementation)
- **Shared database** (PostgreSQL with `SELECT FOR UPDATE` or `INSERT ... ON CONFLICT`)

### Current Behavior (Verified)
- ✅ Idempotency persists across single-node restarts
- ❌ No cross-node coordination (single-container PoC only)

---

## 2. Transport Security: Plaintext HTTP

### Limitation
The PoV runs on plaintext HTTP — TLS is not terminated in the container.

### Impact
Man-in-the-middle attacks can intercept tokens, contracts, and receipts. This is acceptable for PoC testing but **not** for production.

### Remediation
- Terminate TLS at a reverse proxy (nginx, Envoy, Traefik)
- Use mTLS for service-to-service communication
- Rotate TLS certificates automatically via Vault or cert-manager

---

## 3. Token Rotation: One-Time-Use Creates Client Complexity

### Limitation
Every authenticated response rotates the bearer token (one-time-use). Clients must capture the `Authorization-New-Token` header and use it for subsequent requests.

### Impact
- Client implementations that fail to capture the rotated token will experience 401 errors
- Concurrent requests using the same token will fail (only one request succeeds, the rest get 401)
- Test scripts must implement per-thread token chains

### Remediation
- Document the token rotation contract clearly in API specifications
- Provide SDK helpers that automatically capture and rotate tokens
- Consider JWT-based tokens with short TTLs instead of one-time-use tokens for high-throughput scenarios

---

## 4. Tenant Registry: Static, Not Dynamic

### Limitation
The tenant registry is a static list compiled into the binary: `[org-vardhan-intelligence, org-acme-bank-poc, org-test-tenant-valid]`. New organizations created via `POST /api/v1/organizations` are NOT automatically registered as valid tenants.

### Impact
Contracts submitted to dynamically-created org UUIDs (from the API) will be rejected with `DENY_TENANT_UNKNOWN` unless the contract's `organization_id` matches a pre-registered tenant.

### Remediation
- Integrate the organization registry with the tenant registry
- Add an admin endpoint to provision new tenants dynamically
- Implement a tenant enrollment workflow with approval gates

---

## 5. Finding ID Uniqueness Must Be Enforced by Client

### Limitation
The idempotency check is based on `finding_id` alone (not `finding_id + tenant`). If two different tenants submit contracts with the same `finding_id`, the second submission will be rejected as a replay.

### Impact
Cross-tenant finding ID collisions cause false `REJECTED_REPLAY` rejections.

### Remediation
- Prefix `finding_id` with tenant identifier internally: `{tenant_id}:{finding_id}`
- Use UUIDs for finding IDs by default
- Implement server-side finding ID namespace enforcement

---

## 6. Login Throughput Bottleneck

### Limitation
Login uses bcrypt/scrypt password verification, which is intentionally slow. At c100, login latency is 496ms with ~200 req/sec throughput.

### Impact
High-concurrency login scenarios (e.g., bulk client initialization) will experience elevated latency.

### Remediation
- Use API keys for service-to-service authentication (bypass interactive login)
- Implement login caching with short-lived cached session tokens
- Use Argon2id instead of bcrypt for better performance/parallelism

---

## 7. Single-Threaded Receipt Engine Subprocess

### Limitation
Each `validate-canonical` request spawns a new `vardhan-receipt` subprocess. ML-DSA-87 signing is CPU-intensive (6.6ms median). At c100, the subprocess spawn + signing overhead limits throughput to ~138 req/sec.

### Impact
Throughput does not scale linearly beyond c50 on a single container.

### Remediation
- Implement a persistent receipt engine daemon (long-running process) instead of per-request subprocess spawning
- Use a work queue (e.g., channel-based) to batch submissions
- Consider async ML-DSA-87 signing with pre-generated signature pools

---

## 8. No Horizontal Scaling in PoC

### Limitation
The PoC runs as a single Docker container with one control plane API instance. There is no load balancing or horizontal scaling.

### Impact
Performance numbers (c100: 36ms p50 for contract sealing) are not indicative of production capacity with multiple nodes.

### Remediation
- Deploy behind a Kubernetes Service with Horizontal Pod Autoscaler
- Use the `ha_cluster` module for Raft-based consensus across nodes
- Implement sticky sessions or shared idempotency store for token consistency

---

## 9. BLAKE3 Library Version Compatibility (Test Script Issue)

### Limitation
The `blake3` Python library API changed between versions. `blake3.hash(payload)` was replaced with `blake3.blake3(payload).digest()` in newer versions.

### Impact
Crypto benchmark script fails if library version is mismatched.

### Remediation
- Pin `blake3==1.0.11` in requirements
- Use `blake3.blake3(payload).digest()` which works across versions
- Fixed in Dockerfile with `--break-system-packages` for Debian bookworm

---

## 10. Docker Image Build Time

### Limitation
Multi-stage Rust build takes 5-10 minutes (cold) to compile `vardhan_receipt` + `control_plane_api` from source.

### Impact
Iteration cycle for PoV changes is slow.

### Remediation
- Use a pre-built artifact cache (GitHub Actions cache, Docker buildx cache)
- Publish a base image with pre-compiled binaries for faster iteration
- For local dev, mount the binary as a volume instead of rebuilding

---

## Known Issues in Test Scripts

| Issue | Script | Status |
|-------|--------|--------|
| Finding ID collision across benchmark groups | `perf_bench.py` (pre-fix) | ✅ Fixed (global counter + RUN_ID) |
| Token not captured from login response body | `debug scripts` | ✅ Fixed (use `b["token"]`) |
| `blake3.hash()` API mismatch | `crypto_bench.py` | ✅ Fixed (use `blake3.blake3().digest()`) |
| `text=True` with bytes input | `crypto_bench.py` | ✅ Fixed (use `env=env`, raw bytes input) |

---

## Production Readiness Checklist

| Item | PoC Status | Production Required |
|------|-----------|-------------------|
| Docker image builds | ✅ | ✅ (use hardened base image) |
| Health check | ✅ | ✅ |
| Token rotation | ✅ | ✅ |
| Idempotency replay protection | ✅ (single-node) | ⚠️ (needs distributed) |
| Dual signature (Ed25519 + ML-DSA-87) | ✅ | ✅ |
| Transport security (TLS) | ❌ | ✅ |
| Audit logging | ✅ (dev fallback) | ✅ (ledger integration) |
| Horizontal scaling | ❌ | ✅ |
| Dynamic tenant provisioning | ❌ | ✅ |
| Backup/restore of keystores | ❌ | ✅ |
| Rate limiting | ❌ | ✅ |
