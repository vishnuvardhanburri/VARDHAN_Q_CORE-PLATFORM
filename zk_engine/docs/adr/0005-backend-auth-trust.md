# ADR-0005 — Backend API Auth & Trust

**Status:** Accepted (pending approval)
**Date:** 2026-08-07

## Context
The API orchestrates witness-generation *requests*, proof submission, verification status,
and registry reads. It must never see private inputs, and forged "verified=true" must be
impossible.

## Decision

1. **No private inputs ever travel to the API.** The witness generation happens on the
   caller side (CLI/dashboard) using the local engine; the API can accept *prepared
   public inputs only*. Proof submission carries only `proof`, `publicInputs`, `circuitId`,
   `vkHash`.
2. **Auth**: request signing with `HMAC-SHA256` over the canonical request body
   (`X-ZK-Signature`, `X-ZK-Nonce`, `X-ZK-Timestamp`), API key per client (CLI, dashboard).
   Nonce store dedupes replays. (KMS later — DEBT-4.)
3. **Trust boundary:** the API returns `verified: true` only when it either (a) ran the
   local cryptographic verifier with a hash-checked vk, or (b) read status from the chain
   via the whitelisted registry contract. It never trusts a client-supplied flag.
4. **Hardening:** Zod validation on every route, rate limits per key, CORS allowlist,
   structured logging with input redaction (T2).

## Consequences
- CLIs and the dashboard hold secrets; documented in user guide.
- The CI gatekeeper uses a scoped, read-mostly key plus a deploy key for registry writes.
- HMAC is simple and auditable; upgrade to KMS-backed asymmetric signing later.

## Alternatives considered
- OAuth2 client-credentials: heavier than needed for v1.
- EIP-712 signed claims: postponed — good for the future proofs-by-wallets flow.