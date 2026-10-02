# 18 — Backend API Design Review (Milestone 5)

**Status:** Ready for approval
**Date:** 2026-08-08
**Scope:** `packages/api` — REST layer over engine + registry vault deployments
**Related:** ADR-0004 (registry), ADR-0005 (auth & trust), ADR-0006 (proof format), ADR-0008 (crypto freeze), docs/07 (M5), docs/16 (contracts security)

---

## 0. Guiding principles

1. **No cryptographic logic in the API.** All proof verification is delegated to
   the engine's certified verifier; all hashing/serialization is delegated to
   `proof-format`; chain state is read/written only through the registry contract's
   ABI. The API never computes field arithmetic, keccak, poseidon, or ABI encodings
   itself. HMAC request signing (below) is transport authentication — bounded to a
   single infrastructure component, not in the application core.
2. **Trust posture (T4, ADR-0005).** The API reports `verified: true` only when the
   engine's cryptographic verifier accepted the proof against the integrity-checked
   `vkHash` (or chain status `Proved` was read from the registry). A client-supplied
   flag never influences the result.
3. **Single canonical serialization:** every digest and anchor in outbound payloads,
   URLs, and EVM arguments comes from `proof-format` (`publicInputHash`,
   `circuitIdBytes32`). Zero re-derivations exist in `packages/api`.
4. **Clean Architecture:** `domain` (entities + ports, zero deps) → `application`
   (use cases + policies) → `infrastructure` (adapters) → `api` (HTTP presentation).
   Dependencies point inward only.
5. **Contract-first:** route schemas are written as Zod schemas; the OpenAPI document,
   runtime validation, and TypeScript types all derive from the same source.

---

## 1. OpenAPI 3.1 specification

- **Version:** 3.1.0 (JSON Schema 2020-12 alignment; single `type:` anyOf for result
  payloads, `examples`, no `nullable` hacks).
- **Served at:** `GET /v1/openapi.json` (serialized at startup from the shared Zod
  schema registry) and a Swagger UI at `GET /v1/docs` (read-only).
- **Source of truth:** `src/api/schemas.ts` — one `zod` object per request/response
  (section 8). `zod-to-json-schema` produces both the Fastify route validation
  schema and one hand-written `paths` object (referencing the same components).
- **Guarantees:** a repo unit test re-serializes the document and asserts: (a) every
  path listed in the routing table exists in `paths`, (b) every referenced schema
  exists in `components.schemas`, (c) the document passes structural validation.
- **Documented servers:** `${ZK_API_BASE}` placeholder + localhost default.

## 2. REST resource model

| Resource | Method | Path | Role | Idempotency | Notes |
|---|---|---|---|---|---|
| Health liveness | GET | `/v1/health` | public | — | Process alive, non-blocking |
| Health readiness | GET | `/v1/ready` | public | — | Engine+registry reachable check |
| Circuits list | GET | `/v1/circuits` | `read` | — | Engine catalog (id,version,label,nPublic), no artifacts loading |
| Circuit detail | GET | `/v1/circuits/{circuitId}` | `read` | — | Same catalog + vkHash + active from registry config |
| Proof verify | POST | `/v1/proofs/verify` | `submit` | ✔ | Local engine verification; no chain write |
| Proof register | POST | `/v1/proofs/register` | `register` | ✔ (Idempotency-Key) | Chain write via registry `registerProof` |
| Proof status | GET | `/v1/proofs/status/{circuitId}/{publicInputHash}` | `read` | — | Registry `getProofStatus` passthrough, unwrapped |
| Registry info | GET | `/v1/registry` | `read` | — | schemaVersion, totalProofs, paused, proxy |
| Audit log | GET | `/v1/audit` | `audit` | — | `?limit`+`?action` query |
| Metrics | GET | `/v1/metrics` | public | — | Prometheus text/plain |
| OpenAPI (UI / JSON) | GET | `/v1/docs`, `/v1/openapi.json` | public | — | Read-only |

- Path prefix `/v1/…`; internal-role flags are embedded in the auth hook (section 4).
- No `DELETE`/`PATCH` in v1 — the registry owns revocation semantics.

## 3. Authentication strategy (ADR-0005, HMAC-SHA256)

Transport/TLS is the base (behind a TLS or mesh, per deployment). HMAC satisfies the
replay/message-integrity requirements.

**Headers.** Every protected request carries:

```
X-ZK-Key       clientId (opaque, URL-safe, ≤64 ASCII)
X-ZK-Timestamp RFC3339 UTC second (e.g. 2026-08-08T12:00:00Z)
X-ZK-Nonce     ≤128-bit random hex, ≤40 chars (single-use per key, per window)
X-ZK-Signature hex HMAC-SHA256(canonical request, clientSecret) lowercase
```

**Canonical string** (documented for all clients, single implementation in
`application/auth.ts`):

```
METHOD \n
path (literal, no normalization, no trailing slash)
canonicalQuery ('k=v' pairs, sorted raw, joined '&'; '' when none)
X-ZK-Key
X-ZK-Nonce
X-ZK-Timestamp
sha256Hex(bodyBytes)            // sha256 of the exact raw request body; '' when empty
```

- Clock skew window ± `ZK_AUTH_TTL` (default 300 s) — outside => `AUTH-EXPIRED`.
- Signature comparison with `crypto.timingSafeEqual` (`AUTH-BAD-SIGNATURE`).

**Implementation note (2026-08-08):** the canonical body term is
`sha256Hex(canonicalJson(body))` where `canonicalJson` is the parsed body
re-serialized with recursively sorted keys and no whitespace. Raw-byte signing
remains acceptable for clients behind an unmodified proxy, but the canonical-JSON
form is the one validated by this specification so re-formatting proxies cannot
break signatures. The server NEVER signs or verifies proof contents — only
transport authentication (see §0.1).
- Nonce: single-use per `clientId` within the window (bearer replay);
  storage is a TTL map, pruned on access, bounded size hard cap (section 7).
- Unknown `X-ZK-Key` ⇒ `AUTH-UNKNOWN-CLIENT` (no info leak about which field failed).
- Keys: `ZK_API_KEYS='clientId:secret:role,role;…'`; secrets ≥ 32 bytes random;
  loaded at boot from env / vaultfile (0600), **never** logged or exposed.
- KMS-backed asymmetric signing is DEBT-4 (post-M5).

## 4. Authorization model (RBAC)

Roles are per clientId, space delimited strings in `ZK_API_KEYS`, enforced **only**
in the auth prehandler (single decision point, no role checks scattered).

| Role | Grants | Default usage |
|---|---|---|
| `read` | GET circuits, circuit, proof status, registry info | dashboard |
| `submit` | POST proofs/verify (read bundled) | CLI |
| `write` | POST proofs/register (verify + write) | automated ops (deploy key) |
| `audit` | GET audit | ops console |

**Resource-role matrix** (as the route table in § 2): denies 403 with
`AUTH-FORBIDDEN` unless role present. `health`, `ready`, `metrics`, `docs` are
unauthenticated; everything else requires a valid signature first (401).

## 5. Error specification — RFC 9457 (problem+json)

All error responses are `application/problem+json`:

```json
{
  "type": "https://api.zkpe.dev/errors/VALIDATION",
  "status": 422,
  "title": "Request body failed validation",
  "detail": "3 constraints violated",               // developer-oriented
  "instance": "/v1/proofs/verify - 2026-08-08T12:00:00Z",
  "code": "VALIDATION",
  "requestId": "req_7f3a…",
  "errors": [ {"path": "$.publicInputs[2]", "message": "must be a decimal field string"} ]
}
```

| HTTP | Code | Typical case |
|---|---|---|
| 400 | MALFORMED-BODY | JSON parse/UTF-8 |
| 401 | AUTH-* | missing/unknown/bad/expired/replayed (401 + exact code `AUTH-BAD-SIGNATURE` …) |
| 403 | AUTH-FORBIDDEN | role mismatch |
| 404 | NOT-FOUND | unknown circuit / registry entry |
| 409 | STATE-CONFLICT | idempotency key reuse with different payload |
| 422 | VALIDATION | schema rejection (details in `errors[]`) |
| 428 | UNVERIFIED | proof failed the local verifier (no forged true ever) |
| 429 | RATE-LIMITED | token bucket exceeded |
| 500 | INTERNAL | unexpected adapter exception (no secrets; label + requestId) |
| 502 | UPSTREAM-ENGINE | engine verify executor failed |
| 503 | OUT-OF-SERVICE | paused registry / readiness gate failing |

- `type` is a stable, documented URN; clients switch on `code` only.
- Known crypto/adapter errors (`UnknownCircuit`, registry `OnlyProved`… are
  translated in the **application** layer into these codes — never surfaced raw.

## 6. Versioning strategy

- Path-segment versioning `/v1/…`; server rejects unknown versions with 404.
- New version = additive deprecation headers (`Deprecation`, `Sunset`), no breaking
  change to `/v1`; migrations finalize in M10.
- The OpenAPI doc exports the version string in `info.version` == package version.

## 7. Idempotency

- **Nonces** (§3) protect every write for replay within the window; they do **not**
  make retries safe (a retry needs a fresh nonce ⇒ new canonical signature).
- **Idempotency-Keys** on the two `POST` endpoints: client sends `Idempotency-Key:
  uuidv4`; server stores `keyHash = sha256(key)` (never the raw key) →
  `{payloadHash, verified, publicInputHash, txHash|status, at}` for 24 h.
  - same key + identical payload ⇒ `200` with stored result (no chain re-write);
  - same key + different payload ⇒ `409` CONFLICT.
- Because the registry contract opens `registerProof` idempotent for exact replays,
  the API layer still deduplicates *client* retries with different nonces.
- `X-ZK-Timestamp` window rules out replaying a stored response.

## 8. Request/response schemas (Zod definition — single source)

All field elements are **decimal field strings** (`z.string().regex(/^(0|[1-9][0-9]*)$/)`)
as in the rest of the repo; proofs use the exact shape of `Groth16Proof`
(`proof-format`), hex strings `0x`+64 lowercase for hashes.

```ts
// schema.ts (abridged)
const circuitId = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/)
const bytes32    = z.string().regex(/^0x[0-9a-f]{64}$/)
const frField    = z.string().regex(/^(?:0|[1-9][0-9]{1,77})$/)

const pointG1 = z.tuple([frField, frField, frField])                    // pi_a, pi_c
export const ProofSubmission = z.object({
  circuitId: circuitId,
  proof: {
    pi_a: pointG1,
    pi_b: z.tuple([z.tuple([frField, frField]), z.tuple([frField, frField]), z.tuple([frField, frField])]),
    pi_c: pointG1,
  },
  publicInputs: z.array(frField).min(1).max(64),
})
// ProofVerifyResponse, RegisterRequest (=submission), Idempotency-Key header,
// StatusResponse{status:'unproved'|'proved'|'revoked', provedAt}, CircuitListResponse,
// AuditResponse … derived from the same Zod objects (aliases into OpenAPI components).
```

Validation rules (see §9) all expressed as Zod refinements so OpenAPI carries them.

## 9. Validation rules

| Topic | Rule |
|---|---|
| circuitId | `^[a-z0-9][a-z0-9-]*$`, ≤64 B, must match a known engine circuit after load (404 when unknown) |
| proof | exact `Groth16Proof` shape (pi_a, pi_b 3×2, pi_c), coords decimal strings; field-element validity is enforced **by the engine's verifier**, never by the API |
| publicInputs | 1–128 canonical field strings, each ≤32 bytes; count/shape enforced by the engine |
| hashes | `^0x[0-9a-f]{64}$` exactly |
| body size | ≤ 64 KB (`PAYLOAD-TOO-LARGE`) |
| unknown fields | Zod `.strict()` — rejected with path-level 422 errors (no silent stripping that could mask tampering) |
| utf-8 | body must be valid UTF-8; the signed canonical string uses the exact raw request bytes (no re-serialization) |
| timestamps | ISO-8601 UTC; skew window per §3 |
| roles | enforced in the auth hook, one decision point (no per-route re-checks) |

## 10. Rate limiting

- **Per clientId** token bucket (capacity `ZK_RATE_CAP` default 60, refill
  `ZK_RATE_REFILL_PER_MIN` default 20), shared across routes; **stricter cap for
  (submit/write)** `ZK_RATE_CAP_VERIFY` (default 8/min) because verify is
  CPU-bound (T-8).
- Health/ready/metrics/docs are exempt.
- Responses: `429` with `Retry-After` (delta seconds) + `X-RateLimit-*` headers.
- Replay/per-sender DOS is bounded: max-active verifications in-flight
  (`ZK_MAX_INFLIGHT` default 4) — queue overflow ⇒ HTTP 503 (readiness semantics).
- Config per-env: dev default in `config.ts` overridable via env.

## 11. Audit event model

Immutable, append-only. File sink (`ZK_AUDIT_FILE`, 0600) + in-memory ring (last
1024, for the `GET /v1/audit` endpoint). Every entry:

```json
{
  "id": "aud_8a1f…",
  "at": "2026-08-08T12:00:00.000Z",
  "actor": "cli-ops",            "clientId"
  "action": "proof.register",    // enum below
  "resource": "/v1/proofs/register",
  "outcome": "granted",
  "detail": { "circuitId": "poseidon-preimage" },  // no secrets, no inputs, no proof
  "ip": "10.0.2.3",
  "requestId": "req_…"
}
```

Action enum: `auth.failed`, `auth.replayed`, `proof.verify`, `proof.register`,
`proof.status`, `registry.read`, `circuit.list`, `audit.read`, `ratelimit.enforced`.
Outcome: `granted` | `denied` | `failed` | `replayed` | `ok`.
Audit writes are synchronous to disk; files rotated out-of-band, retention 90 d.
**No public inputs, proofs, or secrets are ever written to audit/logs.**

## 12. Structured logging

### Correlation IDs (mandatory)

- Every inbound request is assigned a correlation ID — `X-Request-ID`: generated
  UUIDv4 when the caller does not supply one; validated `^[A-Za-z0-9_-]{8,64}$`
  (malformed ones are rejected with 400 `MALFORMED-CORRELATION`).
- The ID is echoed in the response header, attached to every log record
  (`requestId`), every audit entry, every metric and span attribute
  (`request.id`), and downstream spans continue the W3C `traceparent` context.

- pino (Fastify builtin), JSON lines, `trace/request-id` on every record:
  fields: `time`, level, `req.method`, `req.url`, `statusCode`, `latency`,
  `clientId` (attached after auth), `requestId` (emit), error objects at err.
- **Redact list** (serializers): `req.headers['x-zk-signature']`,
  `req.headers['authorization']`, any body field named `secret`, `key`, `proof`,
  `publicInputs`. The prober never logs request bodies for 4xx/5xx — only
  validation error counts.
- Logging categories: `http` (all), `auth` (replay/skew only), `audit` (separate
  sink §11), `engine` (task outcome summaries: verify OK/FAIL duration — never
  coordinates).

## 13. Metrics

Prometheus text at `/v1/metrics` (aggregate only, no per-request volume issues):

```
http_requests_total{route,method,status}
http_request_duration_seconds{route}          (summary)
proofs_verified_total{circuitId,outcome}
proofs_registered_total{circuitId,outcome}
registry_reads_total{type}
auth_failures_total{code}
nonce_replays_total{clientId}
rate_limit_rejects_total{route}
inflight_verifications
engine_circuits_total
server_uptime_seconds
```

Histograms/buckets fixed in code; no per-client counts reported to public endpoint
(aggregate across clients; detail available via audit/ops role later).

## 14. Health and readiness

- `GET /v1/health` — 200 always when process alive (`{status:'ok'}`), never blocks.
- `GET /v1/ready` — components: `engine` (artifacts present), `registry` (RPC +
  contract probe `getSchemaVersion` ≤ 3 s), gives `<component>: {ok, detail}`;
  503 when any critical fails.

## 15. Distributed tracing (OpenTelemetry)

- **Instrumentation:** OpenTelemetry SDK — W3C `traceparent` extraction on
  ingress, one root span `http.request` per request (`http.request.method`,
  `url.path`, `url.query`, `http.response.status_code`, `api.client_id`,
  `request.id`).
- **Trace chain:** `http.request` → `engine.verify` (success/failure,
  `circuit.id`, duration) → blockchain adapter (`registry.getProofStatus`,
  `registry.registerProof`, `registry.getCircuit`, `registry.registryInfo`).
- **Exporters:** OTLP/HTTP when `ZK_OTEL_ENDPOINT` is set; ConsoleSpanExporter
  dev fallback; `ZK_OTEL_DISABLED=1` to disable entirely.
- **No secrets:** span attributes never carry public inputs, proofs, keys, or
  request bodies.

## 16. Configuration validation (fail-fast)

- `config.ts` — one Zod schema over `process.env` (`ZK_*`), validated before
  any listener opens.
- **Rules:** port ∈ [1, 65535]; `ZK_API_KEYS` ≥ 1 entry of form
  `clientId:secret:role[,role]`, secret ≥ 32 chars, roles ⊆ {read, submit,
  write, audit}, no duplicate clientIds; `ZK_AUTH_TTL` ∈ (0, 3600]; rate-limit
  params ≥ 1; `ZK_REGISTRY_RPC` a valid http(s) URL; `ZK_REGISTRY_PK` optional,
  valid 32-byte secp256k1 key; `ZK_AUDIT_FILE` a usable path;
  `ZK_OTEL_SAMPLER_RATIO` ∈ [0,1].
- **Failure:** structured `config.invalid` log (field names only, never secret
  values) → `process.exit(1)` before the listener binds.
- Unit-tested per rule (`config.test.ts`).

## 17. Dependency injection boundaries

Manual compositional DI — no framework container. One composition root at the edge:

```
config.ts → deps := {
  engine: EngineAdapter,          // infra
  registry?: RegistryAdapter,     // infra (optional; read-only when not set)
  secrets: SecretStore,           // infra
  nonces: NonceStore,             // infra
  audit: AuditSink,               // infra
  metrics: MetricsSink,           // infra
  clock: () => Date.now(),        // injected
}
server = buildApiServer(deps)      // api/ layer only
```

- **domain/** — no imports (entities: `ProofSubmission`, `ProofResult`,
  `ProofStatusEntry`, `CircuitInfo`, `ApiPrincipal`, `AuditEvent`).
- **application/** — depends only on `domain` + ports interfaces.
- **infrastructure/** — implements ports; may use `engine`, `prov`, `circomlib`
  internals.
- **api/** — Fastify + Zod schemas; calls application use cases.
- Unit tests: fake ports; integration tests: real adapters (engine+anvil).

## 18. Repository interfaces (ports)

```ts
// domain/ports.ts
export interface CircuitCatalogPort {
  list(): Promise<CircuitInfo[]>;
  get(id: string): Promise<CircuitInfo | null>;
}
export interface ProofRegistryPort {          // chain read
  getCircuit(id: string): Promise<ChainCircuitConfig | null>;
  getProofStatus(circuitIdBytes: string, inputHash: string): Promise<ProofStatusEntry>;  // hashes createdAt here
  registryInfo(): Promise<RegistryInfo>;
}
export interface ProofWriterPort {            // chain write
  registerProof(circuitId: string, proof: Groth16Proof, publicInputs: string[], opts?: {idempotencyKey?: string}): Promise<RegisterResult>;
}
export interface SecretStorePort { lookup(clientId: string): Promise<ClientSecret | null> }
export interface NonceStorePort { consume(clientId:string, nonce:string, now:number): boolean }
export interface AuditSinkPort { append(entry: AuditEvent): Promise<void>; recent(limit?: number, action?: string): Promise<AuditEvent[]> }
export interface MetricsSinkPort { inc(name, count?, labels?): void; histogram(name, value, labels?): void; render(): string }
```

## 19. Engine adapter interface

```ts
// infra/engine/EngineAdapter.ts   — wraps @zkpe/engine ONLY
export interface EnginePort {
  listCircuits(): Promise<CircuitInfo[]>;
  verify(circuitId: string, publicInputs: string[], proof: Groth16Proof): Promise<VerifyOutcome>;
}
// VerifyOutcome { valid: boolean; task?: TaskSummary }
```

Implementations: `Circuit.load(circuitId)` (integrity-checked artifacts),
verify → `verify(circuit, publicInputs, proven by trusted vkHash)`. The adapter
contains zero hashing/field math; the engine brings T-4 (never `verified=true`
without running the local cryptographic verifier).

## 20. Blockchain adapter interface

```ts
// infra/contracts/RegistryAdapter.ts — ethers v5 over the deployed ABI artifacts only
export interface RegistryAdapterConfig { rpcUrl: string; proxy?: string; chainIdMs?: number; timeoutMs?: number }
export class RegistryAdapter implements ProofRepositoryPort, ProofWriterPort // …
```

- ABI loaded from `contracts/out/ZKVerifierRegistry.sol/ZKVerifierRegistry.json`
  (compiled artifact, foundry) — no duplicate interface, no hand-written ABI.
- `circuitId → bytes32` is **sole-sourced**: `proof-format.circuitIdBytes32(circuitId)`;
  `publicInputHash` is computed once in the application via `proof-format` —
  the adapter itself computes neither (both are the contract's internal
  `keccak256(abi.encode(…))` equivalent; nothing is re-derived here).
- `registerProof(circuitId, vkHash, a,b,c, publicInputs)` — `vkHash` is read from
  the chain config first (`getCircuit`); the adapter rejects if in mismatch with
  the engine's certified vk hash. There are no local HASH implementations.
- Ethers `Contract` + `JsonRpcProvider`, timeout + reconnecting provider params
  controlled by `timeoutMs`/`chainIdMs`; all chain calls are await'ed with a
  circuit-breaking error mapping to §5 codes (`UPSTREAM-REGISTRY`).

---

## Interfaces reserved for later (not built in M5)

- `GET /v1/witness/prepare` etc. — blocked: private inputs never reach the API
  (ADR-0005). The dashboard/CLI prepares witness locally.
- Async verify job queue (T-8) — v0 blocked if on-chain status is already in use;
  noted at `infra/jobs` future boundary.

## Gates (M5 definition of done)

1. `npm run check` green in all workspaces.
2. Unit: auth matrix (signature, skew, replay, unknown key), rate limit, nonces,
   idempotency keys, audit, metrics rendering, schemas ↔ routes ↔ OpenAPI.
3. `api.integration` — real engine prove → POST verify → POST register → GET status
   against anvil-deployed registry (SMOKE register=0), on the **deployed** contracts.
4. Forged-verify rejected (`verified:false`, never 200-ok) — T-4 gate.
5. Replay rejected (same nonce) — ADR-0005 gate.
6. OpenAPI doc self-check + path coverage test.
7. Signed, reviewed; commits only after gates 1–6 green.

> Approval of this document unlocks implementation. Any change to the accepted
> shapes or endpoints reopens this review.