# P1 RBAC Matrix — Vardhan Q-Core Platform

**Finding:** F  
**Status:** IMPLEMENTED & VERIFIED  
**Evidence:** `backend/auth_service/src/authorization.rs` (unit tests pass), `backend/auth_service/tests/integration_auth.rs` (`test_rbac_finding_a_and_b` passes)

---

## Roles

| Role Enum | Canonical String | Aliases Accepted |
|-----------|-----------------|-----------------|
| `Admin` | `ciso_admin` | `admin`, `security_admin`, `root` |
| `Operator` | `cluster_operator` | `operator`, `ops` |
| `User` | `user` | (all other strings) |

**Principle:** Every unrecognized role string maps to `User` (least privilege). No role escalation can occur by supplying an unknown string.

---

## Permission Grant Matrix

| Permission | Admin | Operator | User |
|---|:---:|:---:|:---:|
| `ReadDashboard` | ✅ | ✅ | ✅ |
| `UpdateProfile` | ✅ | ✅ | ✅ |
| `ChangePassword` | ✅ | ✅ | ✅ |
| `ReadSessions` | ✅ | ✅ | ❌ |
| `RevokeSession` (other users) | ✅ | ✅ | ❌ |
| `RevokeSession` (own session) | ✅ | ✅ | ✅ |
| `DrainCluster` | ✅ | ✅ | ❌ |
| `FlushSessions` | ✅ | ❌ | ❌ |
| `ManageApiKeys` | ✅ | ❌ | ❌ |
| `ManageUsers` | ✅ | ❌ | ❌ |
| `UpdateSettings` | ✅ | ❌ | ❌ |
| `RebootCluster` | ✅ | ❌ | ❌ |
| `LedgerAdmin` | ✅ | ❌ | ❌ |

> **NOTE:** `ManageUsers` permission gates all `/api/v1/admin/api-keys` endpoints (list, create, revoke). This is the finding-A/B remediation.

---

## Endpoint Authorization Map

### Auth Service (`/api/v1/auth/*` and `/api/v1/admin/*`)

| Endpoint | Method | Permission Required | Enforcement |
|---|---|---|---|
| `/api/v1/auth/login` | POST | None (public) | Rate-limited |
| `/api/v1/auth/logout` | POST | Authenticated | `require_session` middleware |
| `/api/v1/auth/session` | GET | Authenticated | `require_session` middleware |
| `/api/v1/auth/rotate` | POST | Authenticated | `require_session` middleware |
| `/api/v1/auth/mfa/verify` | POST | Authenticated | `require_session` middleware |
| `/api/v1/admin/api-keys` | GET | `ManageUsers` (Admin only) | Handler-level check |
| `/api/v1/admin/api-keys` | POST | `ManageUsers` (Admin only) | Handler-level check |
| `/api/v1/admin/api-keys/{id}` | DELETE | `ManageUsers` (Admin only) | Handler-level check |
| `/api/v1/admin/sessions` | GET | `ReadSessions` (Admin/Operator) | Handler-level check |
| `/api/v1/admin/sessions/{id}` | DELETE | `RevokeSession` | Handler-level + ownership check |
| `/api/v1/admin/settings` | GET/PUT | `UpdateSettings` (Admin only) | Handler-level check |
| `/api/v1/admin/users/{id}/profile` | GET/PUT | `UpdateProfile` or self | Handler-level check |

### Control Plane API (`/api/v1/organizations/*`)

| Endpoint | Method | Boundary Enforced | Enforcement |
|---|---|---|---|
| `/api/v1/organizations` | GET | User sees only their orgs | `is_member()` filter |
| `/api/v1/organizations` | POST | Authenticated | `require_session` + `is_member` |
| `/api/v1/organizations/{id}` | GET | Org member only | `is_member()` check → 403 |
| `/api/v1/organizations/{id}/members` | GET | Org member only | `is_member()` check → 403 |
| `/api/v1/organizations/{id}/members/{m}/role` | POST | Org admin only | `require_org_admin()` → 403 |
| `/api/v1/organizations/{id}/findings` | GET | Org member only | `is_member()` check → 403 |
| `/api/v1/organizations/{id}/incidents` | GET | Org member only | `is_member()` check → 403 |
| `/api/v1/organizations/{id}/usage` | GET | Org member only | `is_member()` check → 403 |
| `/api/v1/organizations/{id}/subscription` | GET | Org member only | `is_member()` check → 403 |

---

## Security Properties

1. **Authentication-Authorization Separation:** `require_session` middleware authenticates. RBAC permission checks in handlers authorize. These are distinct steps — a valid session does not imply elevated permission.

2. **Role Injection via Middleware:** `AuthenticatedUser` (with its `role` field) is injected by the `require_session` middleware after validating the session token and loading the user profile from the credential store. No handler can receive an `AuthenticatedUser` extension without a valid session.

3. **Immutable Role Assertion:** Roles are loaded from persistent storage at session-handling time; they cannot be supplied by the caller.

4. **Default-Deny:** Unknown permissions or unrecognized role strings resolve to least privilege (`User` / deny).

---

## Test Evidence

| Test | File | Assertion |
|---|---|---|
| `test_role_parsing` | `authorization.rs` unit | All role string variants map correctly |
| `test_least_privilege_permissions` | `authorization.rs` unit | Admin/Operator/User permission boundaries verified |
| `test_session_revocation_privilege` | `authorization.rs` unit | Self-revoke allowed, cross-user requires Operator/Admin |
| `test_rbac_finding_a_and_b` | `integration_auth.rs` | Non-admin Alice gets 403 on admin API key endpoints |
| `test_tenant_isolation_boundary` | `tenant_isolation_test.rs` | Org data unreachable from non-member users |

---

*Last updated: 2026-10-05*  
*Reviewer: VARDHAN Q-CORE P1 Security Audit*
