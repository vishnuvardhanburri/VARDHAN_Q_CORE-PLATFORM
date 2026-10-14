# Reproducible Test Report

## Environment

| Attribute | Value |
|---|---|
| Repository | VARDHAN Q-Core Platform |
| Working directory | `/Users/vishnuvardhanburri/antigravity/VARDHAN_Q_CORE-PLATFORM-main` |
| Git commit SHA (HEAD on `main`) | `f727d722325305afb19a295ee178fbdea7371dae` |
| Binary: control plane API | `target/release/control_plane_api` |
| Binary: receipt engine | `target/release/vardhan-receipt` |
| Rust toolchain | `cargo` stable (1.81+) |
| OS | macOS arm64 (darwin) |

## Test Commands

All commands must be run from the repository root.

### 1. Cryptographic verification + adversarial tests (lab demo)

```bash
bash /Users/vishnuvardhanburri/antigravity/lab_demo_verify.sh
```

Expected output:

```
=== VARDHAN Q-CORE CONTROLLED LAB DEMONSTRATION ===
[TEST 1] Valid Contract Sealing ............ ✅ PASS (SEALED)
[TEST 2] Replay Protection ................ ✅ PASS (REJECTED_REPLAY)
[TEST 3] Trust Boundary (Malformed Hash) .. ✅ PASS (REJECTED_TRUST_BOUNDARY)
[TEST 4] Tampered Signature Rejection ..... ✅ PASS (Invalid)
[TEST 5] Unauthorized Actor Rejection ..... ✅ PASS (DENY_ACTOR_NOT_AUTHORIZED)
FINAL VERDICT: ALL LAB TESTS PASSED
```

### 2. End-to-end lifecycle validation

```bash
python3 scripts/e2e_lifecycle_validation.py
```

Expected output:

```
Total checks: 31
Passed: 31
Failed: 0
```

The Python script manages its own server lifecycle (starts/stops `control_plane_api`),
including a service restart at step 19 to validate state persistence.

### 3. Rust unit tests (receipt engine)

```bash
cargo test -p vardhan_receipt --bin vardhan-receipt
```

Expected output:

```
test result: ok. 59 passed; 0 failed; 0 ignored
```

### 4. Rust regression tests (enterprise lifecycle edge cases)

```bash
cargo test -p control_plane_api --test org_lifecycle_edge_cases
```

Expected output:

```
test result: ok. 13 passed; 0 failed; 0 ignored
```

### 5. Rust tenant isolation tests

```bash
cargo test -p control_plane_api --test tenant_isolation_test
```

Expected output:

```
test result: ok. 6 passed; 0 failed; 0 ignored
```

### 6. Performance benchmark

```bash
python3 scripts/performance_benchmark.py
```

## Commit-SHA Discrepancy Resolution

An earlier report referenced a commit SHA mismatch. This has been resolved:
the repository HEAD on `main` is:

```
f727d722325305afb19a295ee178fbdea7371dae
```

All binaries used in the evidence pack were built from this exact commit. The fix
that resolved the lifecycle-suite failures was adding `db.flush()` to `save_json()`
in `backend/control_plane_api/src/lib.rs` (lines 66–70), ensuring sled writes
persist to disk before the response is sent.

## Receipt Hash and Verifier Version

| Field | Value |
|---|---|
| Receipt ID (sample) | `VQR-48d478cb-152d-4247-b617-953a5d9e6493` |
| Payload hash (sample) | `bb9a430e563af36f4ee4132d1dce0d90b93f94b974583903caa0bd1c1ddb36d3` |
| Issuer key fingerprint | `21c77fb2e4418ee7c1d70e4b7af011a56b574b11f81129df6dc2d728b044b6da` |
| Ed25519 signature | Valid (19 checks passed, 0 failures) |
| ML-DSA-87 signature | Valid (19 checks passed, 0 failures) |
| Verifier | `vardhan-receipt verify --receipt-id <id>` (built from commit `f727d72`) |
| Verification checks passed | 19 of 19 |

## Known Issues and Workarounds

| Issue | Resolution |
|---|---|
| `auth_config.json` in repo root shadows dev defaults | Use default development config (tenants: `org-vardhan-intelligence`, `org-acme-bank-poc`, `org-test-tenant-valid`; actor prefix: `svc:vardhan-intelligence:`) or set `VARDHAN_AUTH_CONFIG_PATH` to a valid config |
| `db.flush()` missing in `save_json` | Fixed — added at `lib.rs:66-70` |
| Token from login response body is pre-rotation | Use `Authorization-New-Token` header from every response for the current token |
| Replay returns HTTP 200, not 422 | Check `body.status` field, not HTTP status code |
| Owner self-role-change returns 409 | Expected behavior — owner→non-owner is blocked by `enterprise_api.rs:162` |
