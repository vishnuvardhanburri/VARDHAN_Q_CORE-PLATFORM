# 20 — Milestone 9: Web Dashboard (design + route/component plan)

Status: **implemented as `packages/dashboard` (`@zkpe/dashboard@0.1.0`)** —
working tree, uncommitted (release-preparation commit pending).
ADR: covered by ADR-0005 (backend auth trust), ADR-0011 (API request
signing); dashboard-specific trust rules below.

## 1. Scope & non-goals

The dashboard is a **read-only observability surface** over the M5 REST API,
the `@zkpe/circuit-lib` certified manifests, and stored Gatekeeper (M8)
reports. It:

- shows **registry status** (proxy, schema version, paused, per-circuit
  verifier/vkHash/active, total proofs),
- shows **circuit/version + artifact status** (certified vkHash, artifact
  bundle digest, on-disk artifact manifest match),
- shows **proof status** by anchor (`proved | unproved | revoked`) — the
  anchor a user pastes is only *read* and never displayed against
  private data,
- shows **Gatekeeper results** (stored M8 gate reports: verified, checks,
  reasons, circuitId, vkHash, artifactHash, publicInputHash, keyId, on-chain),
- shows the **API audit trail** (audit log read),
- never renders **private inputs, private witnesses, or proof signatures
  with secrets** — by construction the client codebase contains zero logic
  for witness generation; the BFF forwards only the API's public DTOs
  (docs/04 §6 acceptable-risk: "Dashboard shows proofs but never private
  inputs").

Non-goals (no redesign of existing layers): no witness generation, no
proving, no registration, no contract writes, no re-implementation of
HMAC/canonical signing (the dashboard reuses `@zkpe/api`'s `ApiClient`),
no modification of the Gatekeeper trust model (the dashboard merely *reads*
stored gatekeeper reports).

## 2. Server/BFF tier

`packages/dashboard/src/server/dashboard.ts` — Fastify (same runtime as the
API package). It is the **only component holding API credentials**; the
browser never sees `ZK_API_KEY`/`ZK_API_SECRET` or the session secret.

| Env | Purpose |
|---|---|
| `ZK_DASHBOARD_PORT` (3000) / `ZK_DASHBOARD_HOST` (127.0.0.1) | bind |
| `ZK_DASHBOARD_SESSION_SECRET` | HMAC key signing the session cookie (dev default; prod required) |
| `ZK_DASHBOARD_PASSWORD` | admin login password (prod required) |
| `ZK_DASHBOARD_SESSION_TTL_MS` | session lifetime (default 8 h) |
| `ZK_DASHBOARD_INSECURE_DEV` | allow dev-only defaults when `=1` (fail-closed otherwise) |
| `ZK_DASHBOARD_API_URL` | API `baseUrl` for `ApiClient` |
| `ZK_DASHBOARD_API_KEY` / `ZK_DASHBOARD_API_SECRET` | API read+audit credentials (HMAC signing, server-side only) |
| `ZK_DASHBOARD_GATE_REPORTS` | dir of stored gatekeeper reports (default `data/gatekeeper/`) |
| `ZK_DASHBOARD_SECURE_COOKIES` | `1` → `Secure` cookie flag (also auto when port 443) |
| `ZK_DASHBOARD_UI_ALLOWLIST` | *(planned; not implemented in v0.1.0)* circuit + vkHash allow-list for the "trusted artifacts" panel |

Mapped 1:1 to `parseConfig` in `src/server/config.ts`.

Sessions: cookie `zkdash` — `v1.<expiry-epoch-ms>.<hmac-sha256(secret, payload)>`,
HttpOnly, SameSite=Lax, Secure when behind HTTPS (`port 443` detection or
explicit `ZK_DASHBOARD_SECURE_COOKIES=1`). No signing keys reusable
client-side: only the password + session cookie are shipped to the browser.

## 3. Route plan (BFF, reverse proxy to existing API)

All `/api/*` except `/api/auth/login`, `/api/health` require a valid
session cookie; every route remains **read-only** against the API.

| Route | Backing | Notes |
|---|---|---|
| `GET /api/health` | static | `{ok}` for load balancer |
| `POST /api/auth/login` `{password}` | local session | constant-time compare; failure → 401 problem+json |
| `POST /api/auth/logout`, `GET /api/auth/whoami` | local session | |
| `GET /api/registry` | `ApiClient.registryInfo` | proxy; error → typed problem |
| `GET /api/circuits` | `ApiClient.listCircuits` + circuit-lib manifests | merge live registry with certified manifests |
| `GET /api/circuits/:circuitId` | `ApiClient.listCircuits` + manifest + `checkArtifacts` | artifact status per circuit |
| `GET /api/proofs/status/:circuitId/:publicInputHash` | `ApiClient.proofStatus` | validates params; passthrough |
| `GET /api/audit?limit=` | `ApiClient.auditLogs` | read via new `auditLogs()` client method |
| `GET /api/gatekeeper` | reads `ZK_DASHBOARD_GATE_REPORTS` → latest report list + summary | gatekeeper-view data, no live gate rerun |
| `GET /api/gatekeeper/report/:file` | same | single-report detail |

## 4. Implemented React pages (colocated tests)

| Route/page | Components | Data |
|---|---|---|
| `/` (login if no session) | `Login`, `Layout` (header/nav/footer) | session check |
| `/overview` | `Overview`: `StatCard`s (registry, circuits, proofs, gate), `RegistryPanel`, `HealthPanel`, `GateSummaryList` | `/api/registry`, `/api/health`, `/api/circuits`, `/api/gatekeeper` |
| `/circuits` | `CircuitTable`, `CircuitRow` (id, version, nPublic, artifactsReady, vk match) | `/api/circuits` |
| `/circuits/:id` | `CircuitDetail`: manifest card, artifact checks, bundle digest, registry config | `/api/circuits/:id` |
| `/proofs` | `ProofStatusForm` + `ProofStatusCard` (anchor input → status) | `/api/proofs/status/:id/:hash` |
| `/gatekeeper` | `GateReportList` (summary pills), `GateReportDetail` (checks table) | `/api/gatekeeper`, `/api/gatekeeper/report/:file` |
| `/audit` | `AuditTable` (actor, action, resource, outcome, at, ip, requestId) | `/api/audit` |

Conventions:

- no `dangerouslySetInnerHTML` anywhere (checked by lint rule in
  `eslint` of the dashboard package — `react/no-danger`),
- typed DTOs in `src/ui/types.ts`, `fetchJson` wrapper in `src/ui/api.ts`
  that never resolves non-2xx to data,
- statuses rendered via a single `StatusBadge` (proved/unproved/revoked,
  green/red/amber).
- all UI strings escape through React rendering (XSS-safe defaults).

## 5. Security posture (implemented)

- CSP + security headers set at the Fastify layer via a global `onSend`
  hook (`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, CSP `default-src 'self'; script-src 'self';
  style-src 'self' 'unsafe-inline'; img-src 'self' data:;
  connect-src 'self'; base-uri 'self'; frame-ancestors 'none'`).
- Session cookie: `zkdash` = `v1.<expiry-epoch-ms>.<hmac>` — HttpOnly
  (XSS can't leak), SameSite=Lax (CSRF), Secure behind HTTPS (`port 443`
  detection or `ZK_DASHBOARD_SECURE_COOKIES=1`). No signing keys reusable
  client-side: only the password + session cookie are shipped to the
  browser.
- API credentials never reach the browser; rate limiting + audit are the
  API's concern (unchanged).
- `npm audit` dependency gate runs in each PR (existing M5 CI gate covers
  all workspaces).

## 6. Test plan (as implemented)

- BFF server behavior is covered end-to-end by the repo-level smoke
  `scripts/smoke-dashboard.mjs` (boots the **built** server, login,
  route guards, registry/circuits/gatekeeper/audit passthrough, CSP,
  SPA fallback) — wired as `npm run smoke` in the dashboard package.
- UI tests are colocated in `src/` (vitest + @testing-library/react):
  `src/ui/router.test.ts`, `src/ui/components/Login.test.tsx`,
  `src/ui/components/OverviewPage.test.tsx`,
  `src/ui/components/GatekeeperPage.test.tsx` (~13 tests; no
  `dangerouslySetInnerHTML` anywhere).
- Demo gatekeeper reports ship under `packages/dashboard/data/gatekeeper/`
  (4 fixtures: verified pass, blocked, expired, revoked).

## 7. Build pipeline (as implemented)

- `npm run build` → `tsc -p tsconfig.build.json` (server+shared → `dist/server`,
  `vite build` → `dist/web`).
- `main`/`types` point at the emitted server module
  (`dist/server/server/dashboard.js` / `.d.ts`); `start` runs
  `node dist/server/server/main.js`; smoke = `node ../../scripts/smoke-dashboard.mjs`.
- Test/dev: `vitest run` + `vite` (dev server proxies to Fastify in dev).
- `dist/` is gitignored; the web bundle is never committed.