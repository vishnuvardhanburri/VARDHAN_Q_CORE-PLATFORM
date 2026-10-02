# ADR-0011 — Backend API: Request Signing, RBAC, Idempotency & Errors

**Status:** Accepted
**Date:** 2026-08-09
**Companion docs:** ADR-0005 (auth & trust), docs/18 (API design review),
docs/04 (security review), docs/07 (roadmap M5).

## Context

Milestone 5 ships the HTTP gatekeeper (`packages/api`) between clients (CLI,
dashboard, CI gatekeeper) and the engine/registry. ADR-0005 fixed the trust
model (HMAC-SHA256 request signing, no private inputs, `verified` only from a
cryptographic verifier). This ADR records the concrete wire decisions the
implementation converged on, so clients and the future gatekeeper share one
specification.

## Decision

### 1. Request signing (canonical string)

Every protected request carries four headers, signed with `HMAC-SHA256` using
the per-client secret:

- `x-zk-key` — client id,
- `x-zk-nonce` — client-generated, one-shot (server rejects reuse; must be
  ≥ 8 characters printable ASCII),
- `x-zk-timestamp` — ISO-8601 UTC; rejected when older than `ZK_AUTH_TTL`
  (default 300 s) or ahead of the clock,
- `x-zk-signature` — lowercase hex `HMAC-SHA256(secret, canonical)`.

The canonical string is:

```
METHOD
PATH            (as received: Fastify URL, query stripped)
QUERY           (raw query string or empty)
x-zk-key:VALUE\nx-zk-nonce:VALUE\nx-zk-timestamp:VALUE
body            (canonical JSON when present, else the literal `null`)
```

The server recomputes the canonical form from the parsed `req.body` with the
same canonical JSON printer used by `proof-format` (key-sorted, no
whitespace), so byte-exact client/server agreement is enforced by unit tests
(signing/verifying in the same suite). Comparison of the hex signatures is
constant-time.

### 2. Roles & route model

| Role | Routes |
|---|---|
| `read` | GET `/v1/circuits`, `/v1/proofs/status/:c/:h`, `/v1/registry` |
| `submit` | POST `/v1/proofs/verify` |
| `write` | POST `/v1/proofs/register` |
| `audit` | GET `/v1/audit` |

Public (unsigned): `/v1/health`, `/v1/ready`, `/v1/metrics`, `/v1/docs`,
`/v1/openapi.json`.

Roles are per-key lists (`clientId:secret:role1,role2`) decoded from
`ZK_API_KEYS`; unknown/unmapped roles are rejected at startup.

### 3. Idempotency (`POST /v1/proofs/register`)

- Clients MUST send an `idempotency-key` header (`^[A-Za-z0-9-]{8,64}$`)
  for register; its absence is a 422.
- Server hashes the key and the canonical payload; same key + same payload
  → returns the stored response verbatim, zero registry writes.
- Same key + different payload → `409 STATE-CONFLICT`.
- Different keys → independent writes.
- Concurrency: per-key exclusivity; two parallel calls with the same key do
  not double-write (verified by a concurrency test).

### 4. Rate limiting

Token bucket, two pools: general (`ZK_RATE_CAPACITY` / refill per minute) and
CPU-intensive verify/register cost bucket (default 8/min). `429 RATE-LIMITED`
carries `detail.retryAfterMs`. Limitation by bucket happens after
authentication, so unauthenticated clients only ever see auth errors.

### 5. Errors — RFC 9457 problem+json

All failures are `application/problem+json`: `{type, title, status, code,
detail, instance, requestId}`. Well-defined `code` values (VALIDATION,
AUTH-MISSING, AUTH-BAD-SIGNATURE, AUTH-NONCE-REUSED, AUTH-EXPIRED,
AUTH-FORBIDDEN, RATE-LIMITED, UNVERIFIED, STATE-CONFLICT, NOT-FOUND,
UPSTREAM-REGISTRY, PAYLOAD-TOO-LARGE, UNSUPPORTED-MEDIA-TYPE,
MALFORMED-BODY, OUT-OF-SERVICE, INTERNAL). Unmapped Fastify-level failures
fall back to documented codes (400/415/413) — never a bare 500 for a client
mistake (fuzz-tested across 300 seeded malformed bodies with no 500 leakage
or unhandled exceptions in the log).

## Consequences

- All four participants (web UI, CLI M6, CI gatekeeper M8, dashboards M9)
  use these headers; the API's own test suite is the reference for the
  canonical string (sign and verify share the same canonical function).
- Rotation: env file with per-env keys; documented in the ops runbook (M10).
- Limitation: HMAC + shared secrets is still DEBT-4 (KMS later). ADR-0005
  upgrade path unchanged.

## Alternatives considered

- Authorization: scopes in signed JWT — heavier, no benefit at one-or-few
  API hosts in v1.
- Dedicated idempotency proxy — no; policy lives in the register route.
- OAuth2 client-credentials — rejected in ADR-0005; still rejected.