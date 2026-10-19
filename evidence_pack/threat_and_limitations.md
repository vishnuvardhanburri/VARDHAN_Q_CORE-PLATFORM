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

2. **Production transport security available but not default**: TLS is implemented via
   rustls behind the `tls` feature flag (`cargo build --features tls`). It is **not enabled
   by default** and requires `VARDHAN_TLS_CERT_PATH`/`VARDHAN_TLS_KEY_PATH` to be set.
   The `VARDHAN_QCORE_SERVICE_SECRET` that enables authenticated service
   transport is not set in the test environment.

3. **HSM/KMS integration available but not default**: A Vault transit engine provider
   (`VaultKeyProtectionProvider`) is implemented behind the `vault` feature flag
   (`cargo build --features vardhan_keystore/vault`). It is wired into
   `EnvironmentKeyProtectionProvider::select()` for production mode. However, this has
   not been tested against a live Vault instance (the tests are unit tests for config
   detection and provider attributes). The `VARDHAN_PRODUCTION_KEK` and
   `VARDHAN_KMS_PROVIDER` environment variables are not set.

4. **No multi-node replay protection**: Idempotency is implemented via atomic file
   creation (`O_CREAT|O_EXCL` + `fsync`) — single-process. In a multi-node deployment,
   this would be vulnerable to race conditions and split-brain scenarios. A distributed
   coordination service (sled cluster, Redis with Redlock, or Raft/etcd) is needed.

5. **No independent security assessment**: No third-party audit, penetration test, or
   certification (e.g., SOC 2, ISO 27001, FIPS 140-3) has been performed. The
   adversarial tests included in Phase 8b are developer-authored.

6. **Audit trail integrity is local**: The audit trail (`audit_trail.rs`) produces
   BLAKE3 hash chains with ML-DSA-87 signatures and `fsync` durability, but publication
   to an external log sink (e.g., CloudTrail, SIEM) is not configured. Audit events are
   written to a local JSONL file and logged to tracing.

7. **Issuer registry uses dev config only**: The `IssuerRegistry` with
   `DENY_ISSUER_UNBOUND` enforcement is operational. In development mode, the registry
   is `default_for_development()` which includes `svc:vardhan-intelligence:` → `dev-local`.
   In production, the registry must be configured via `VARDHAN_QCORE_ISSUER_REGISTRY_JSON`.

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
