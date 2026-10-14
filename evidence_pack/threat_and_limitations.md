# Threat and Limitations Statement

## What the Tests Establish

1. **Cryptographic correctness**: The prototype produces receipts with valid Ed25519 and
   ML-DSA-87 signatures. An independent verifier (separate binary, same keystore) confirms
   both signatures verify against the corresponding public keys.

2. **Adversarial rejection**: Altered payloads, invalid signatures, replay attempts,
   unknown tenants, and unauthorized actors are all rejected by the sealing engine.
   These rejections are enforced at multiple layers: idempotency store (replay),
   trust-boundary validator (malformed hashes), and policy authority (tenant/actor/policy).

3. **Replay persistence**: Idempotency flag files survive a full server restart,
   ensuring sealed findings cannot be re-submitted even after process termination.

4. **Authorization binding**: Each receipt binds `actor_workload_id`, `policy_reference`,
   `tenant_id`, and `decision` into the signed payload hash. The policy authority
   evaluates these fields against a fail-closed registry before sealing.

## What the Tests Do NOT Establish

1. **No independently authenticated execution source**: The `actor_workload_id` is set
   by the client submitting the contract. There is no integration with an external
   identity provider (e.g., SPIFFE, OIDC) or hardware attestation (e.g., Nitro Enclave,
   TPM) that would cryptographically bind the actor identity to an execution environment.
   The authorization-to-execution traceability is internal to the prototype.

2. **No production transport security**: The API runs over plain HTTP. TLS is not
   configured. The `VARDHAN_QCORE_SERVICE_SECRET` that enables authenticated service
   transport is not set in the test environment.

3. **No production key custody**: Keys are stored in a development keystore with a
   development KEK. No HSM or KMS provider is configured. The `VARDHAN_PRODUCTION_KEK`
   and `VARDHAN_KMS_PROVIDER` environment variables are not set.

4. **No multi-node replay protection**: Idempotency is implemented via local file-based
   flag files (single-process). In a multi-node deployment, this would be vulnerable to
   race conditions and split-brain scenarios.

5. **No independent security assessment**: No third-party audit, penetration test, or
   certification (e.g., SOC 2, ISO 27001, FIPS 140-3) has been performed.

6. **No audit ledger publication**: The audit ledger produces BLAKE3 hash chains with
   ML-DSA-87 signatures, but publication to an external log sink is not configured.
   Audit events are logged to tracing only.

7. **No Q-Core issuer registry integration**: The `VARDHAN_QCORE_ISSUER_REGISTRY_JSON`
   environment variable is not set, so the Q-Core issuer registry is not bootstrapped.
   This means there is no integration with the Q-Core trust framework.

8. **No AER-KEP-Q runtime**: The `VARDHAN_AER_KEP_Q_VAULT_PASS` environment variable is
   not set, so no aerospace-grade quantum-safe cryptographic runtime is attached.

## Threat Model

The prototype mitigates the following threats within its lab scope:

| Threat | Mitigation | Scope |
|---|---|---|
| Contract replay | File-based idempotency check | Single-process only |
| Payload tampering | Trust boundary validator (hash chain) | SHA-256 evidence hashes |
| Signature forgery | Dual Ed25519 + ML-DSA-87 signatures | Requires key compromise |
| Unauthorized actor | Policy authority (fail-closed tenant/actor registry) | Dev config only |
| Tenant cross-access | Tenant registry binding in contract | Dev config only |

The prototype does NOT mitigate:

| Threat | Why |
|---|---|
| Network interception | No TLS configured |
| Key exfiltration | No HSM/KMS, keys on disk |
| Distributed replay | Single-Process idempotency |
| Impersonation at source | No external identity binding |
| Audit log tampering | No publication to external sink |

## Conclusion

The tests establish that the Q-Core prototype functions correctly within a controlled
lab environment. They do not establish that LGT has a confirmed security vulnerability
or that the prototype is production-ready. The evidence is narrowly scoped to specific
cryptographic and authorization behaviors under test conditions.
