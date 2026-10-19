# Threat Model — Synthetic Financial-Services PoV

## Status and scope

**Scenario:** synthetic financial-services trust/evidence workflow running locally in Docker.  
**Not an LGT assessment:** no LGT requirement, workflow, incident, architecture, budget or buyer intent has been confirmed. The earlier expansion “Logistics Gateway Trust” was invented and is withdrawn.  
**Test status:** first-run results were reported before an audit of the harness. Corrected implementation and test changes are on the follow-up branch; a fresh corrected run is pending.

## Assets and trust boundaries

| Asset | Intended security property | Current lab implementation / limitation |
|---|---|---|
| Sealed finding receipt | Tamper evidence and independent verification | Reported dual Ed25519 + ML-DSA-87 signatures; fresh run pending |
| Finding ID / replay state | Duplicate submission rejection | Local filesystem flags; single-node only; global ID namespace |
| Session token | Authenticated API use | One-time token rotation, creating client concurrency complexity |
| Signing keys | Confidentiality and integrity | Development keystore; no production KMS/HSM assurance |
| Tenant identity | Correct organization binding and authorization | Static allowlist; dynamic organization creation is not linked to policy registry |
| Transport | Confidentiality and service authenticity | Plaintext local HTTP in the PoV; no TLS/mTLS validation |
| Audit data | Retrievability and reviewability | Audit endpoint response was reported; completeness, integrity under admin compromise, retention and export remain unproven |

Trust boundaries are: client-to-HTTP API, URL organization ID to contract organization ID, API-to-receipt subprocess, receipt engine to filesystem idempotency/keystore, and receipt-to-independent-verifier.

The API handler now explicitly rejects requests whose URL organization ID differs from the contract organization's organization_id field, returning HTTP 403 with status REJECTED_TENANT_MISMATCH. This was added after finding that the prior handler ignored the URL path identifier. The mismatch test is present in the follow-up branch; **the new guard has not been run through the corrected integration test yet**.

## Threats and controls to test

| Threat | Intended control | Evidence status |
|---|---|---|
| Forged or modified receipt | Independent verification of signatures and receipt structure | Previously reported pass; fresh run required |
| Payload/hash tampering | Canonical validation and integrity checks | Previously tested for a malformed short hash only; broader mutation/fuzz testing required |
| Duplicate/replayed finding | Atomic idempotency state | Sequential replay previously reported; concurrent assertion was defective and is corrected, pending rerun |
| Cross-tenant route/payload mismatch | Handler checks URL org ID against contract org ID | Guard added; explicit negative test added; validation pending |
| Unknown tenant | Fail-closed static tenant policy | Previously reported pass; retest route and payload with matching unknown tenant ID |
| Unauthorized actor string | Policy authority rejects unapproved workload ID | Previously reported pass; prefix matching is not a cryptographic workload identity proof |
| Unauthenticated API request | Authentication middleware returns 401 | Previously reported pass; retest |
| Malformed/oversized input | Schema validation, bounded resources and safe failure | Only a small malformed-input case previously tested; size/time limits and fuzzing not established |
| Token theft/reuse | One-time-use token rotation | Limited happy/negative path; not a comprehensive token abuse assessment |
| Concurrent replay across instances | Shared/consensus idempotency state | **Not implemented/validated**; local filesystem flags are single-node |
| MITM or credential interception | TLS/mTLS | **Not present in local PoV** |
| Key theft, rotation, recovery | Production KMS/HSM lifecycle and access controls | **Not established** |
| Resource exhaustion | Rate limiting, quotas, backpressure, bounded payloads | Not validated |
| Audit alteration or deletion | Tamper-resistant centralized audit ledger, retention and export controls | Not validated by a successful HTTP 200 alone |
| Crash/restart consistency | Durable state and reproducible restart tests | Previously reported manually; not yet included as a fresh reproducible pass in the corrected run |

## Security test semantics

A test “pass” means that the specific test input produced its asserted response on the tested source revision. It does not establish broad security. The fresh security runner is expected to record 24 explicit assertions, including:
- valid sealing and signature presence;
- sequential replay rejection;
- invalid hash, unauthorized actor, spoofed actor, unknown tenant and malformed input rejection;
- unauthenticated request denial;
- route/payload tenant mismatch rejection;
- exactly one SEALED and four REJECTED_REPLAY responses for five concurrent submissions to the same tenant route;
- audit endpoint response and independent verification.

The above are **expected assertions, not fresh passed outcomes** until a corrected run completes and the raw JSON is inspected.

## Retained high-priority limitations

1. **Single-node replay state:** file-based and not coordinated across replicas.
2. **Static tenant allowlist:** organization creation does not automatically provision a matching policy tenant.
3. **Route-to-payload tenant binding:** new guard is awaiting integration test.
4. **Plaintext transport:** local-only; do not expose the port publicly.
5. **Development secrets:** the lab contains fallback development credentials; never reuse them in deployed systems.
6. **Per-request subprocess:** receipt sealing invokes a child process on each request and ML-DSA-87 full sealing cost dominates the path.
7. **Production control plane:** TLS/mTLS, KMS/HSM, durable backup/restore, HA/DR, rate limiting, monitoring, authorization review and external assurance remain separate gates.

## Decision

**CONDITIONAL / further lab validation only.** Do not describe this as a penetration test, independent security assessment, certified compliance control, production-ready platform, proven ROI, or validated LGT requirement. Buyer-specific discovery is still required to confirm whether the hypothesized workflow problem exists.
