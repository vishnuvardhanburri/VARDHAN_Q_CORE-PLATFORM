# Runtime Configuration

## Environment Variables

| Variable | Scope | Required | Description |
|---|---|---|---|
| `VARDHAN_ENV` | Rust + TS | Recommended | Environment selector: `production` \| `development` \| `test`. Defaults to `development`. |
| `VARDHAN_PRODUCTION_KEK` | Rust (`vardhan_keystore`) | **YES (production)** | Production KEK (Key Encryption Key) for envelope encryption of private keys. Must be supplied by KMS/HSM. |
| `VARDHAN_KMS_PROVIDER` | Rust (`vardhan_keystore`) | **YES (production)** | KMS/HSM provider identifier (e.g., `aws-kms`, `azure-kms`, `pkcs11`). |
| `VARDHAN_AUTH_CONFIG_PATH` | Rust (`vardhan_receipt`) | **YES (production)** | Path to `auth_config.json` containing tenant and policy allowlists. |
| `VARDHAN_BINARY_HASH` | Rust (`core_crypto`) | **YES (production)** | Expected BLAKE3 hash of the production binary for anti-tamper verification. |
| `VARDHAN_IDEMPOTENCY_DIR` | Rust + TS | Recommended | Directory for persistent idempotency registry. Defaults to `target/idempotency/`. |

## Configuration Files

### auth_config.json

Loaded by `backend/vardhan_receipt/src/auth_config.rs` via `AuthConfigLoader::load_required()`.

```json
{
  "tenants": ["org-vardhan-intelligence", "org-acme-bank-poc", "org-test-tenant-valid"],
  "policies": [
    {
      "policy_id": "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
      "policy_version": "1.0",
      "governed_actions": ["SEAL_VERIFIED_FINDING"],
      "authorized_actor_prefixes": ["svc:vardhan-intelligence:"]
    }
  ]
}
```

**Production requirement:** File must exist and be valid JSON. If missing in
production mode, `AuthConfigLoader::load_required()` returns `Err`, failing
closed.

### KV Store Paths

| Crate | Default Path | Permissions | Description |
|---|---|---|---|
| `vardhan_keystore` | `keystores/<key_id>/` | 0o700 (dir), 0o600 (files) | Encrypted key material (`.enc` files) |
| `vardhan_idempotency` | `target/idempotency/` | 0o700 | Persistent idempotency registry |
| `audit_ledger` | `audit_logs/` | 0o700 | Append-only JSONL audit log |
| `enterprise_tenant` | `enterprise_data/` | 0o700 | Tenant-scoped RBAC data |

## Runtime Mode Matrix

| Mode | VARDHAN_ENV | Key Protection | Auth Config | Binary Hash | Local Provider |
|---|---|---|---|---|---|
| Production | `production` | ✅ Required (KMS/HSM KEK) | ✅ Required (auth_config.json) | ✅ Required | ❌ Rejected |
| Development | `development` | Optional (local KEK) | Optional (defaults) | Optional | ✅ Allowed |
| Test | `test` | Optional (local KEK) | Optional (defaults) | Optional | ✅ Allowed |

## Q-Core Gateway Configuration

The `vardhan-receipt` binary accepts the following CLI flags:

```
vardhan-receipt --config <PATH>     # Path to auth_config.json
vardhan-receipt --port <N>          # Listen port (default: 8080)
vardhan-receipt --bind <ADDR>       # Bind address (default: 0.0.0.0)
```

All security-critical configuration is via environment variables, not CLI flags.

## Intelligence Plane Configuration

The `intelligence_plane` package uses environment variables for API keys:

| Variable | Provider | Required |
|---|---|---|
| `GROQ_API_KEY` | Groq | Yes (LLM-powered analysis) |
| `SERPER_API_KEY` | Serper | Yes (web search) |
| `GITHUB_TOKEN` | GitHub | Optional (rate limits) |

Configuration directory: `intelligence_plane/config/` (if present).
State directory: `intelligence_plane/.vardhan_state/` (default).

## Security Posture Defaults

| Setting | Default | Change For |
|---|---|---|
| `VARDHAN_ENV` | `development` | Set `production` in deployment |
| Idempotency TTL | 24 hours | Configure expiry per business need |
| Key deprecation TTL | 24 hours | Configurable via `KeyIdentity::deprecate()` |
| Max observation age | N/A (not yet configurable) | Future: freshness policy |
| Tenant isolation | Type-level (Rust) + config (TS) | Preserved always |
