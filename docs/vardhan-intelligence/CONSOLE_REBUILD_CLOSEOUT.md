# Command Console Rebuild — Closeout (2026-10-17)

## What changed
Full replacement of the borrowed `intelligence_plane` template with OUR Vardhan Q-Core
Command Console. Deleted 24 mock-first files (fake Login with client-side roles,
mock telemetry Dashboard, dead quantum/signal-engine utils, hero asset, App.css).
New surface:

- `src/services/qcore.ts` — typed control-plane client, zero mocks. Bearer attach
  on every protected call, honors `authorization-new-token` rotation.
- `src/auth/AuthContext.tsx` — real session lifecycle (signIn → me → signOut,
  MFA challenge, 401 auto-reset to login).
- `src/components/Login.tsx` — real username/password + MFA challenge UI.
- `src/App.tsx` — AuthProvider + view router (overview/recon/resilience/reporting/cluster).
- `src/console/Shell.tsx` — header: plane-health badge, org switcher, operator
  identity, server-side sign-out.
- `src/console/OverviewView.tsx` — executive-report risk score + 3R counts
  (Recon/Resilience/Reporting entry), attention strip, read-only briefs.
- `src/console/ReconView.tsx` — findings inventory + key-registry issuers,
  filter, blast-radius line, CycloneDX v1.6 CBOM export (tenant-scoped).
- `src/console/ResilienceView.tsx` — key-lifecycle counts, rotation dry-run
  (client-side rehearsal, no server mutation), verification envelope,
  remediation proposals.
- `src/console/ReportingView.tsx` — DORA/SWIFT control map, receipts explorer,
  alerts ingest + transitions, policy baseline/observe + drift, remediation and
  incident transitions, canonical receipt validation, executive-report +
  assessor JSON exports.
- `src/console/ClusterView.tsx` — plane health, AER-KEP-Q epoch + exposure,
  members/roles, subscription/usage, session list.

## Auth error — root cause + proof
Old UI never logged in and never sent `Authorization: Bearer`, so every protected
call 401'd with `Missing or malformed Authorization header`.

- Without Bearer: `GET /api/v1/me` → 401 `{"error":"Missing or malformed Authorization header"}`.
- With session: `POST /api/v1/auth/login` (dev admin) → 64-char token →
  `/api/v1/me` → 200 `{"authenticated":true,"username":"admin"}`.
- Rotation: single-use binding verified live — `T1` dies after one authenticated
  call, rotated `T2` (from `authorization-new-token`) works; `qcore.ts`
  `storeRotation()` follows the chain transparently.

## Verification (2026-10-17, darwin/arm64, local stack)
- `npx tsc -p tsconfig.app.json`: 0 errors in our 11 files (187 remaining are
  pre-existing `src/server/*` breakage, untouched, not imported by the console).
- `npm run build` (`vite build`): clean in 268ms.
- `npx vitest run`: 95/101 pass — identical to pre-rebuild baseline (6 failures
  pre-existing in `supplyChainSecurity` + `boundary` tests).
- `npx oxlint` on our files: 0 warnings, 0 errors.
- Docker: rebuilt `vardhan-intelligence:dev-latest`, `:3000` serves the new
  console (`<title>Vardhan Q-Core — Command Console</title>`, bundle contains
  `vardhan.console.session_token`).
- CI gates used: `intelligence-plane-build` runs `npm install && npm run build`
  (verified locally); real-artifact gate + injection tests untouched.

## CI actuals (authenticated `gh api`, repo `vishnuvardhanburri/VARDHAN_Q_CORE-PLATFORM`)
- Enterprise `39034274524` @ `c72b353`: completed / **success**.
- Correctness `39034274533` @ `c72b353`: completed / **success**.
- Enterprise `39034266993` @ `6640897`: completed / success.
- Correctness `39034267023` @ `6640897`: completed / **failure** —
  `ha_cluster --test raft_l3_failure`, `test_partition_healing`:
  `Election timed out — no stable leader` after 722s (L3 partition-timing flake
  on the superseded commit; HEAD green on both gates).
- HEAD `c72b353` (byzantine-fix + rustfmt): both gates green.

## Competitor grounding
Views implement the steal-worthy set from `COMPETITOR_DASHBOARD_RESEARCH.md`
(2026-10-17): QuProtect 3R header + risk score, AQtive blast-radius + dry-run,
IBM asset→crypto graph (findings→receipts→issuers), Remediator perf envelope
(honest derived counts, no invented histograms), BasejumpQDN key-pool panels,
DORA/SWIFT mapping + assessor export, Rekor-style receipts explorer, Raft parity
note (only plane-published fields shown, nothing invented).

## Sign-in self-revocation fix (commit `7dfed0f`, 2026-10-17)
- Symptom: every sign-in died after login — `Missing or malformed
  Authorization header` on next load, then `Invalid or expired session`.
  Passwords were never the cause (server logs show `LoginSucceeded`).
- Root chain: (1) rotation header `authorization-new-token` was CORS-hidden
  from browser JS (`CorsLayer::new()` sends no allow/expose headers by
  default); (2) 4–5 console-boot requests raced on the same single-use
  token, losers replayed a stale token → whole-family `revoke_by_id`.
- Fix: `build_cors()` (allow + expose rotation headers) in
  `control_plane_api/src/main.rs`; 30s idempotent rotation grace window in
  `auth_service/src/session.rs` (stale replays still revoke; post-restart
  empty-token edge rotates forward); serialized session-aware queue +
  in-memory token mirror + cross-tab sync in `qcore.ts`; single shared
  `me()` probe in `AuthContext`; sequential orgs→health boot in `Shell`.
- Evidence: `auth_service` 53/53, `control_plane_api` lib 43/43,
  `npm run build` clean, oxlint 0 warnings on touched files, vitest
  95/101 (= pre-existing baseline, 6 unrelated failures on clean tree),
  live 5× concurrent `/api/v1/me` burst → 5×200, CORS preflight +
  `access-control-expose-headers: authorization,authorization-new-token`
  verified against the redeployed stack.
- Action for the operator: sign in again at `http://localhost:3000` with
  the `.env` admin credentials — old stored tokens were revoked by the
  pre-fix race and will not resurrect.
