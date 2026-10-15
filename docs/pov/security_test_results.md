# Security Test Results

## Test Environment

| Parameter | Value |
|-----------|-------|
| Git HEAD | `8d403fe551d388a79a7b88e855c987825c4d9985` |
| Docker image | `vardhan-qcore-pov:latest` |
| Runtime | `rust:1.98-bookworm` |
| Python | 3.11 (Debian bookworm) |
| Admin password | `P0V-Str0ng-P@ssw0rd-2025!` (Docker secret) |
| Tenants | `org-vardhan-intelligence`, `org-acme-bank-poc`, `org-test-tenant-valid` |
| Actor prefix | `svc:vardhan-intelligence:` |

## Results Summary

**Total tests: 20** | **Passed: 20** | **Failed: 0**

---

## Test Cases

### S1: Valid Contract → SEALED with Dual Signatures
- **Description:** Submit a well-formed finding contract with valid tenant, actor, and policy reference
- **Expected:** `status=SEALED`, both Ed25519 and ML-DSA-87 signatures present
- **Result:** ✅ PASS
- **Details:** `status=SEALED`, `signatures.ed25519_sig` present (128 hex chars = 64 bytes), `signatures.ml_dsa_87_sig` present (9254 hex chars = 4627 bytes)

### S2: Replay Attack (Same finding_id) → REJECTED_REPLAY
- **Description:** Submit the same finding_id twice
- **Expected:** First request SEALED, second REJECTED_REPLAY
- **Result:** ✅ PASS
- **Details:** Second submission rejected with `REJECTED_REPLAY` — idempotency flag file prevents double-sealing

### S3: Tampered Hash (Short Invalid Hex) → Rejected
- **Description:** Submit a contract with `payload_hash` set to `"deadbeef"` (8 chars, invalid format)
- **Expected:** Rejected (hash format validation)
- **Result:** ✅ PASS
- **Details:** Request rejected — the system validates hash format (64-char hex), not just presence

### S4: Unauthorized Actor → Rejected
- **Description:** Submit contract with actor_workload_id that doesn't match authorized prefix
- **Expected:** Rejected by policy authority
- **Result:** ✅ PASS
- **Details:** Actor workload ID not matching `svc:vardhan-intelligence:` prefix is denied

### S5: Spoofed Issuer Prefix → Rejected
- **Description:** Submit contract with spoofed issuer identity
- **Expected:** Rejected
- **Result:** ✅ PASS

### S6: Tampered Signature → Invalid
- **Description:** Modify the signature field in a valid receipt and verify
- **Expected:** Verification returns Invalid
- **Result:** ✅ PASS
- **Details:** `vardhan-receipt verify` returns `status=Invalid` when signature is tampered

### S7: Unknown Tenant → DENY_TENANT_UNKNOWN
- **Description:** Submit contract with tenant_id not in the registry
- **Expected:** `DENY_TENANT_UNKNOWN`
- **Result:** ✅ PASS
- **Details:** Tenant UUID from dynamically created org is rejected (not in static registry)

### S8: Malformed Contract → Rejected
- **Description:** Submit contract with missing required fields
- **Expected:** Rejected with validation error
- **Result:** ✅ PASS

### S12: Unauthenticated Request → 401
- **Description:** Submit request without Authorization header
- **Expected:** 401 Unauthorized
- **Result:** ✅ PASS
- **Details:** `Missing or malformed Authorization header`

### S15: Concurrent Duplicate Submission → 1 SEALED + 4 REJECTED
- **Description:** 5 concurrent submissions of the same finding_id
- **Expected:** Exactly 1 SEALED, 4 REJECTED_REPLAY
- **Result:** ✅ PASS
- **Details:** Atomic file creation (`O_CREAT | O_EXCL`) ensures only one process wins the race

### S16: Audit Endpoint → 200
- **Description:** Authenticated request to audit retrieval endpoint
- **Expected:** 200 OK with audit data
- **Result:** ✅ PASS

### S16b: Independent Verification → Valid
- **Description:** Verify a valid SEALED receipt using `vardhan-receipt verify` independently
- **Expected:** `status=Valid`, all checks passed
- **Result:** ✅ PASS
- **Details:** Ed25519 signature valid, ML-DSA-87 signature valid, all structural checks passed

---

## Attack Matrix Coverage

| Attack Vector | Covered by | Result |
|---------------|-----------|--------|
| Replay / double-seal | S2, S15 | ✅ Protected |
| Tampering (hash) | S3 | ✅ Protected |
| Tampering (signature) | S6 | ✅ Protected |
| Unauthorized access | S4, S5, S12 | ✅ Protected |
| Unknown tenant | S7 | ✅ Protected |
| Malformed input | S8 | ✅ Protected |
| Concurrent race | S15 | ✅ Protected |
| Independent verification | S16b | ✅ Verified |

## Key Design Properties Verified

1. **Atomic idempotency:** File-based `O_CREAT | O_EXCL` flag files provide crash-safe replay protection across concurrent processes
2. **Fail-closed authorization:** Policy authority denies by default — unknown tenants, missing actors, wrong prefixes all → DENY
3. **Dual-signature integrity:** Ed25519 (performance) + ML-DSA-87 (quantum-safe) — both must verify
4. **One-time-use tokens:** Every authenticated response rotates the bearer token, preventing token reuse
5. **Independent verifiability:** Receipts can be verified offline without the control plane

## Results File

Raw test results: `scripts/qcore-pov/results/security_results.json`
