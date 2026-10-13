# Vardhan Q Core — Security

## Security Architecture

All security is cross-cutting across the Vardhan Technologies platform.

### Canonical Security Chain

```
Identity → Authentication → Authorization → Policy → Trust
  → Cryptography → State → Execution → Evidence → Audit
```

### Tenant Isolation

- **Rust:** `TenantScoped<T>` newtype binds all objects to `tenant_id` at the
  type level. Cross-tenant references are structurally impossible.
- **TypeScript:** Tenant ID is passed through `runContext.actor_workload_id`.
  All Q-Core operations are scoped to the tenant.

### RBAC

- Roles: Owner, SecurityAdmin, Auditor, Operator, Analyst, Viewer.
- `check_permission()` validates tenant membership before any permission check.
- `SecurityLevel` enum: Foundation, Protected, Enterprise, HighAssurance,
  Critical, Resilience, Sovereign.

### Policy Enforcement

- Policies loaded from external JSON config (`auth_config.json`).
- No hardcoded tenant/actor/policy allowlists in production.
- Fail-closed: unknown tenant, policy, action, or actor → DENY.

### Trust Boundary (22 checks)

- Enforced on BOTH TypeScript and Rust sides.
- All 22 checks must pass for any finding to cross into Q Core.
- No partial passes.

### Transaction State Machine

- 10 allowed transitions, 4 terminal states.
- All mutations go through `transition()`.
- `reject()` routes through `transition()` (F-002 verified).

### Cryptographic Protection

- ML-KEM-1024 (FIPS 203) for key encapsulation.
- ML-DSA-87 (FIPS 204) for post-quantum signing.
- Ed25519 for classical dual-signature defense-in-depth.
- BLAKE3 for content hashing and fingerprinting.
- SHA3-512 for transcript hashing (AER-KEP-Q).
- AES-256-GCM for envelope encryption.
- HKDF for key derivation.
- Zeroize for memory protection.

### Idempotency & Replay Protection

- Persistent idempotency store (survives process restart).
- Per-epoch replay rejection (HashSet of message IDs).
- Deterministic AEAD nonces per sequence number.

### Audit & Evidence

- Append-only JSONL audit ledger.
- BLAKE3 hash chain (prev_hash commitment).
- Full SHA-256 evidence content hashes (no truncation).
- 10-field canonical payload in sealed receipts.
- Independent verification by separate `VardhanVerifier` module.

### Key Lifecycle

- Status: Active → Rotating → Deprecated → Retired → Revoked.
- Deprecation with configurable TTL (default 24h).
- Secure deletion (random overwrite + fsync + unlink).
- Zeroize in-memory material.
- Production requires HSM/KMS-backed KEK.

### Fail-Closed Behavior

| Component | Production Failure |
|---|---|
| Key protection | Panic (no KMS/HSM provider) |
| Auth config | Deny all (no config file) |
| Binary integrity | Exit 137 (no binary hash) |
| Trust boundary | Reject (any failed check) |
| Policy evaluation | Deny (unknown tenant/policy/actor) |
| State machine | Err(AlreadyTerminal) (terminal state) |
| Idempotency | Reject duplicate (same key) |
