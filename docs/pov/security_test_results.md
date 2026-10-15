# Security Test Results

## Evidence status

The updated security test suite reports **24 assertions passed and 0 failed**. Latest run timestamp: `20261015_131411`.

The first local run reported **20 assertions passed and 0 failed**. The security test script has since been corrected because the original S15 concurrent-duplicate case only asserted that five responses returned; it did not assert one seal and four replay rejections as the report claimed.

The updated S15 test now submits the same finding identifier to the same tenant route using independent one-time tokens and asserts exactly one SEALED response, four REJECTED_REPLAY responses, and that every response has an expected status. This adds two S15 assertions and two route/payload mismatch assertions, making **24 assertions expected** in the updated suite.

Additionally, the idempotency guard was hardened against TOCTOU races: `record_finding_sealed` now performs atomic `O_CREAT | O_EXCL` file creation *before* sealing (rather than after), and returns `false` if another concurrent process already claimed the finding_id — ensuring exactly-once sealing even under heavy concurrency.

All examples are synthetic. The previous LGT-labelled test hostnames and tenant label have been replaced in the test script with reserved synthetic names. No real LGT data, credentials, systems or endpoints are used.

## Test environment

| Parameter | Updated run |
|---|---|
| Service | Local control-plane API and receipt-engine binaries in Docker (`vardhan-qcore-pov:latest`) |
| Runtime | Rust 1.98; Python 3.11 on Debian Bookworm |
| Transport | Plaintext local HTTP; not suitable for production transport |
| Tenant registry | Static development registry |
| Idempotency store | Local filesystem flag files; single-node only |
| Source Git HEAD | `0c335d085fd064d18004f1b6d2ab891ec484483b` |
| Container | `qcore-pov` running on port 8080, healthy |

## Assertion results

| Check | Result | Notes |
|---|---|---|
| Login succeeds | ✅ PASS | HTTP 200 |
| Token present | ✅ PASS | Authorization header returned |
| Org creation | ✅ PASS | HTTP 201 |
| Org ID present | ✅ PASS | Organization ID in response |
| S1: Valid contract returns 200 | ✅ PASS | HTTP 200 |
| S1: Status is SEALED | ✅ PASS | `SEALED` |
| S1: Ed25519 signature present | ✅ PASS | `ed25519_sig` field present and valid |
| S1: ML-DSA-87 signature present | ✅ PASS | `ml_dsa_87_sig` field present and valid |
| S2: Replay returns 200 | ✅ PASS | HTTP 200 with rejection status |
| S2: Status is REJECTED_REPLAY | ✅ PASS | `REJECTED_REPLAY` |
| S3: Tampered hash not SEALED | ✅ PASS | `deadbeef` payload rejected |
| S4: Unauthorized actor not SEALED | ✅ PASS | Non-admin token rejected |
| S5: Spoofed prefix not SEALED | ✅ PASS | `svc:vardhan-intelligence:` prefix spoofed — rejected |
| S6: Tampered sig verification returns Invalid | ✅ PASS | Independent verifier reports `Invalid` |
| S7: Unknown tenant not SEALED | ✅ PASS | Unknown tenant rejected |
| S8: Malformed contract not SEALED | ✅ PASS | Invalid JSON rejected |
| S9: Route/payload tenant mismatch returns 403 | ✅ PASS | HTTP 403 |
| S9: Route/payload tenant mismatch has explicit rejection | ✅ PASS | `REJECTED_TENANT_MISMATCH` |
| S12: Unauthenticated denied (401) | ✅ PASS | HTTP 401 |
| S15: Exactly one concurrent submission seals | ✅ PASS | 1 SEALED out of 5 concurrent |
| S15: Remaining concurrent submissions rejected as replay | ✅ PASS | 4 REJECTED_REPLAY |
| S15: All responses are expected | ✅ PASS | All 5 responses have expected status |
| S16: Audit endpoint accessible (200) | ✅ PASS | HTTP 200 |
| S16b: Valid receipt verifies | ✅ PASS | Independent verification succeeds |

## What was and was not validated

The updated tests exercise selected happy-path and adversarial cases. They do not constitute a comprehensive security assessment, independent penetration test, cryptographic review, compliance certification, or production readiness review.

In particular, this suite does not yet prove:

- safe dynamic tenant onboarding;
- replay rejection across multiple service instances;
- secure transport (the lab uses plaintext HTTP);
- production-grade KMS/HSM integration, key rotation, backup or recovery;
- durable audit integrity across malicious administrator access;
- rate-limiting and resource-exhaustion protections;
- high availability or multi-region disaster recovery; or
- that every invalid request class fails closed.

The known single-node and static-tenant limitations remain material. See limitations and remediation.

## Reproduction

From a clean checkout, run:

```bash
cd scripts/qcore-pov
./run.sh
```

The corrected runner exits non-zero when the security assertion script fails. Keep the timestamped log, raw JSON, source SHA, and container/environment metadata with the results. Do not treat a successful Docker build or a green unrelated CI workflow as evidence that this security matrix passed; inspect the actual test exit code and result counts.
