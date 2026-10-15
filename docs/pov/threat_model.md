# Threat Model

## Scope

**System under test:** VARDHAN Q-Core control plane + receipt engine (PoV Docker environment)  
**Deployment context:** Enterprise financial-services workflow (LGT gateway)  
**Assumed environment:** Single-container deployment with plaintext HTTP transport (PoC scope)

---

## Assets

| Asset | Sensitivity | Protection |
|-------|------------|------------|
| Sealed finding receipts | HIGH — tamper-evident audit trail | Ed25519 + ML-DSA-87 dual signatures |
| Finding IDs (idempotency) | MEDIUM — replay prevention | File-based atomic flag files (O_CREAT \| O_EXCL) |
| Session tokens | HIGH — bearer credential | One-time-use rotation |
| Signing keys | CRITICAL — cryptographic material | AES-256-GCM envelope encryption, dev fallback |
| Tenant registry | HIGH — authorization boundary | Static allowlist in policy authority |

---

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                      VARDHAN Q-Core Container                   │
│                                                                 │
│  ┌─────────────┐     ┌────────────────────┐     ┌───────────┐  │
│  │ HTTP Client  │────│  Control Plane API  │────│           │  │
│  │ (Test Script)│    │  (axum server)      │    │ Receipt   │  │
│  └─────────────┘     │  - Auth middleware │    │ Engine    │  │
│                        │  - Token rotation  │    │ (subprocess│  │
│                        │  - Org management  │    │ validate-  │  │
│                        └───────────────────┬┘    │ canonical) │  │
│                                              │   └───────────┘  │
│  ┌─────────────────────────────────────────────┐               │
│  │  Trust Boundary: Subprocess Invocation      │               │
│  │  - Env vars propagated explicitly            │               │
│  └─────────────────────────────────────────────┘               │
│                                                                 │
│  ┌─────────────────────────────────────────────┐               │
│  │  Trust Boundary: Filesystem (idempotency)   │               │
│  │  - /var/lib/vardhan/idempotency/            │               │
│  │  - /var/lib/vardhan/keystore/               │               │
│  └─────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Attack Surface

### 1. Authentication (Control Plane API)
- **Threat:** Token replay / token theft
- **Mitigation:** One-time-use token rotation — every authenticated response invalidates the old token via `Authorization-New-Token` header
- **Risk:** If a client fails to capture the rotated token, subsequent requests return 401

### 2. Authorization (Policy Authority)
- **Threat:** Unauthorized tenant access
- **Mitigation:** Fail-closed tenant registry — only `org-vardhan-intelligence`, `org-acme-bank-poc`, `org-test-tenant-valid` are allowed. Unknown tenants receive `DENY_TENANT_UNKNOWN`
- **Risk:** Static tenant list requires manual provisioning

### 3. Idempotency / Replay (Receipt Engine)
- **Threat:** Finding re-submission (double-sealing)
- **Mitigation:** Atomic file creation (`O_CREAT | O_EXCL`) at `$VARDHAN_IDEMPOTENCY_DIR/sealed_{finding_id}.flag` — survives process restarts (durable on filesystem)
- **Risk:** File-based idempotency does not scale across distributed nodes (future work: shared ledger or Redis)

### 4. Cryptographic Integrity (Receipt Engine)
- **Threat:** Receipt tampering / signature forgery
- **Mitigation:** Dual-signature model (Ed25519 for performance + ML-DSA-87 for quantum resistance) — both signatures must verify
- **Risk:** Ed25519 is vulnerable to quantum attacks; ML-DSA-87 provides quantum-safe backup

### 5. Transport Security
- **Threat:** Man-in-the-middle
- **Mitigation (PoC):** Plaintext HTTP within Docker container; TLS terminates at reverse proxy in production
- **Risk:** No transport encryption in PoC scope — acceptable for internal testing only

### 6. Actor Identity Spoofing
- **Threat:** Malicious actor impersonates `svc:vardhan-intelligence:*`
- **Mitigation:** Actor workload ID prefix enforced by policy authority — `svc:vardhan-intelligence:` prefix required for ALLOW
- **Risk:** Prefix-based enforcement is a namespace check, not a cryptographic identity proof (future: SPIFFE/SPIRE integration)

---

## Attack Matrix

| Attack ID | Attack | Target | Mitigation | Test Result |
|-----------|--------|--------|------------|-------------|
| S1 | Valid contract submission | Receipt engine | Dual signatures (Ed25519 + ML-DSLA-87) | ✅ SEALED |
| S2 | Replay (same finding_id) | Idempotency | File-based flag | ✅ REJECTED_REPLAY |
| S3 | Tampered payload_hash (short hash) | Integrity | Hash format validation | ✅ Rejected |
| S4 | Unauthorized actor (spoofed prefix) | AuthZ | Prefix enforcement | ✅ Rejected |
| S5 | Spoofed issuer prefix | AuthZ | Prefix enforcement | ✅ Rejected |
| S6 | Tampered signature | Integrity | Signature verification | ✅ Invalid |
| S7 | Unknown tenant | AuthZ | Tenant registry | ✅ DENY_TENANT_UNKNOWN |
| S8 | Malformed contract | Validation | Schema validation | ✅ Rejected |
| S12 | Unauthenticated request | AuthN | Bearer token required | ✅ 401 |
| S15 | Concurrent duplicate submission | Idempotency | File lock (O_EXCL) | ✅ 1 SEALED + 4 REJECTED |
| S16 | Audit endpoint access | Audit log | Token-auth required | ✅ 200 |
| S16b | Independent receipt verification | Crypto | Dual signature verify | ✅ Valid |

---

## Residual Risk

| Risk | Likelihood | Impact | Mitigation Status |
|------|-----------|--------|-------------------|
| Token rotation bug in test client | Medium | Test failure | Client-side fix documented |
| Finding ID collision across runs | High (without fix) | False replay rejection | `RUN_ID` + global counter |
| Transport MITM (PoC only) | High | Data interception | TLS in production deployment |
| File-based idempotency (non-distributed) | Medium (scale) | Replay across nodes | Future: Redis/shared ledger |
| Ed25519 quantum vulnerability | Low (current era) | Signature forgery | ML-DSA-87 quantum-safe backup |
