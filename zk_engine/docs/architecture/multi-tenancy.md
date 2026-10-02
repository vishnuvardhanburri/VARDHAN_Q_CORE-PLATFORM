# Multi-Tenancy Architecture

> **Author**: Vishnu Vardhan Burri  
> **Status**: Implemented (v0.2.0+)

## Overview

The `zk-proof-engine` API supports multi-tenant isolation. Each API client credential is bound to a **tenant**, and all operations (proof verification, registry reads, audit events) carry the tenant context through the full request lifecycle.

## Trust Model

**Tenant identity is always server-derived.** It flows from:

```
ZK_API_KEYS env var
  → EnvSecretStore (boot-time parse)
    → ClientSecret.tenantId
      → Authenticator (HMAC verify)
        → ApiPrincipal.tenantId
          → ExecutionContext.tenantId
            → AuditEvent.tenantId
```

**Tenants are never taken from client-supplied request headers.** A client cannot claim a different tenant by setting any header.

## Configuration

### Single-Tenant (Default)

Existing configuration without `tenantId` continues to work with zero changes. The `tenantId` defaults to `clientId`:

```bash
# Format: clientId:secret(>=32 chars):roles
ZK_API_KEYS="my-service:mysupersecretkey32chars_minimum:read,submit"
# → tenantId = "my-service" (same as clientId)
```

### Multi-Tenant

Append `:<tenantId>` to assign multiple clients to the same tenant:

```bash
# Format: clientId:secret(>=32 chars):roles:tenantId
ZK_API_KEYS="dev-client:secretA32chars...:read,submit:org-acme;prod-client:secretB32chars...:write:org-acme;auditor:secretC32chars...:audit"
# → dev-client  → tenantId = "org-acme"
# → prod-client → tenantId = "org-acme"
# → auditor     → tenantId = "auditor" (defaults to clientId)
```

## Roles

| Role | Access |
|---|---|
| `read` | GET /v1/circuits, /v1/proofs/status, /v1/registry |
| `submit` | POST /v1/proofs/verify |
| `write` | POST /v1/proofs/register (also requires submit-level verify) |
| `audit` | GET /v1/audit (all tenants visible to auditors) |

## Audit Isolation

The audit log supports tenant-scoped reads:

```typescript
// Operator (audit role): sees all tenants
await audit.recent(50, undefined, undefined);

// Scoped: only tenant-a's events
await audit.recent(50, undefined, 'tenant-a');

// Compound: only tenant-a's proof.verify events
await audit.recent(50, 'proof.verify', 'tenant-a');
```

The `/v1/audit` endpoint requires the `audit` role and currently returns all events (cross-tenant view for operators). Per-tenant audit endpoints can be added as needed.

## Isolation Guarantees

| Property | Enforced |
|---|---|
| tenantId derived from server-side secret store | ✅ |
| tenantId never from client request headers | ✅ |
| Cross-tenant idempotency key isolation | ✅ |
| Audit events tagged with tenantId | ✅ |
| Audit read supports per-tenant filter | ✅ |
| Rate limits scoped per clientId | ✅ |
| Nonce replay protection per clientId | ✅ |

## Extending to Full Multi-Tenant Isolation

For production multi-tenant deployments with strict data isolation:

1. Replace `InMemoryJobStore` with a DB-backed `JobStorePort` that shards by `tenantId`
2. Add per-tenant `/v1/audit` endpoint (read-filtered by `ctx.tenantId`)
3. Consider per-tenant rate limit buckets (currently per-clientId, which is equivalent when 1:1)
4. Add tenant quota management via `MetricsSinkPort` gauges
