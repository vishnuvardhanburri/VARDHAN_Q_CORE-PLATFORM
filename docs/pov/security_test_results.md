# Security Test Results

## Evidence status

The first local run reported **20 assertions passed and 0 failed**. The security test script has since been corrected because the original S15 concurrent-duplicate case only asserted that five responses returned; it did not assert one seal and four replay rejections as the report claimed.

The updated S15 test now submits the same finding identifier to the same tenant route using independent one-time tokens and asserts exactly one SEALED response, four REJECTED_REPLAY responses, and that every response has an expected status. This adds two S15 assertions and two route/payload mismatch assertions, making **24 assertions expected** in the updated suite. The tenant-binding guard and updated test harness are on the follow-up branch; a fresh run has not yet been recorded, so these are not new pass results.

All examples are synthetic. The previous LGT-labelled test hostnames and tenant label have been replaced in the test script with reserved synthetic names. No real LGT data, credentials, systems or endpoints are used.

## Initial test environment

| Parameter | Initial report |
|---|---|
| Service | Local control-plane API and receipt-engine binaries in Docker |
| Runtime | Rust 1.98; Python 3.11 on Debian Bookworm |
| Transport | Plaintext local HTTP; not suitable for production transport |
| Tenant registry | Static development registry |
| Idempotency store | Local filesystem flag files; single-node only |
| Source revision recorded by the original report | 8d403fe551d388a79a7b88e855c987825c4d9985 |
| New corrected security run | Pending |

## First-run assertions and current interpretation

| Check | Initial reported result | Qualification |
|---|---|---|
| Valid contract sealing | SEALED; Ed25519 and ML-DSA-87 signature fields present | Presence is not the same as independent validation of every security property |
| Duplicate submission | REJECTED_REPLAY reported | Basic sequential replay scenario; re-run on corrected harness |
| Tampered hash | Rejected | Re-run after changes |
| Unauthorized actor | Not SEALED | Limited input case; not a comprehensive identity proof |
| Spoofed issuer prefix | Not SEALED | Limited string/policy case |
| Tampered signature | Independent verifier reported invalid | Re-run and preserve exact verifier output |
| Unknown tenant identifier | Not SEALED | Does not by itself validate API route-to-payload tenant binding |
| Malformed contract | Not SEALED | Limited malformed-input case |
| Missing authentication | HTTP 401 reported | Does not test every authentication path |
| Concurrent duplicate | One SEALED + four REJECTED_REPLAY was reported in prose | The original assertion did not verify the response distribution; corrected test now asserts it, pending rerun |
| Audit endpoint | HTTP 200 reported | Endpoint accessibility is not proof of audit completeness, tamper resistance, retention or regulatory compliance |
| Independent receipt verification | Valid receipt reported | Re-run and preserve output and artifacts |

## What was and was not validated

The initial tests exercise selected happy-path and adversarial cases. They do not constitute a comprehensive security assessment, independent penetration test, cryptographic review, compliance certification, or production readiness review.

In particular, this suite does not yet prove:

- tenant isolation across the URL route, payload organization identifier, credentials, signing keys, and audit records;
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

The corrected runner must exit non-zero when the security assertion script fails. Keep the timestamped log, raw JSON, source SHA, and container/environment metadata with the results. Do not treat a successful Docker build or a green unrelated CI workflow as evidence that this security matrix passed; inspect the actual test exit code and result counts.
