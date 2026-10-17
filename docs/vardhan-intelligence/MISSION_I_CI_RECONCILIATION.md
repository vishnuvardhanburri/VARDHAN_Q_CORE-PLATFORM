# Mission I — CI Reconciliation (1107c3e + 4724717 terminal state)

Date (UTC): 2026-10-17. HEAD at write time: `1107c3efba61cdc9f7f4dff6b3724c66729bacf5`
(`main`, in sync with `origin/main`). History since 4724717: `1107c3e → 4724717 → 7e07949 → 842f66f`.
`git show --stat 1107c3e`: 8 files, +837/−35. `gh` auth dead — all run data via
unauthenticated GitHub REST (`api.github.com/repos/.../actions/runs[/<id>|/<id>/jobs]`).

## 4724717 — terminal conclusions (all six workflows resolved)

| Workflow | Run ID | Conclusion | Failing step / evidence | Follow-up |
|---|---|---|---|---|
| Enterprise Release Gate | 39026286433 | **failure** | Job "Enterprise release readiness", step 9 "Workspace tests": `cargo test --workspace` (CARGO_BUILD_JOBS:2, enterprise-release.yml:43-46). Test identity: `vardhan_idempotency durable_registry_is_tenant_isolated` → `DuplicateDetected` on key `request-1` (record `tx-0` leaked from parallel test `durable_registry_concurrent_duplicate_is_rejected`). Root cause: `durable.rs` timestamp-only temp names collided within the same tick — REAL bug, not the prior RAFT flake (which was `1a70887 --test-threads=1`). Later gates skipped. | Fixed in 1107c3e (nanos + atomic seq + pid); verified below |
| Correctness & Performance | 39026286465 | **success** (was in_progress; terminal 2026-10-17T11:36:49Z) | — | Closes half the Mission H gate |
| Web Contract | 39026286456 / 39026286427 | success | — | — |
| Sovereign CI | 39026286453 | success | — | — |
| Supply Chain | 39026286441 | success | — | — |
| Local Runtime | 39026286457 | success | — | — |

## 1107c3e — terminal conclusions (all six workflows resolved)

| Workflow | Run ID | Conclusion | Evidence | Follow-up |
|---|---|---|---|---|
| Web Contract | 39029010239, 39029010117 | success | Both terminal success | — |
| Local Runtime | 39029010099 | success | Terminal success | — |
| Sovereign CI | 39029010053 | success | Terminal success | — |
| Supply Chain | 39029010034 | success | Terminal success | — |
| Enterprise Release Gate | 39029010017 | **success** | Completed success (polled post-sweep) — temp-path fix confirmed in CI | None |
| Correctness & Performance | 39029010085 | in_progress at last poll | Jobs started 11:31:14/15Z; still running | Monitor to terminal |

## Fix verification (local, Mission I)

- `cargo test -p vardhan_idempotency --test durable`: 6/6 pass isolated; 3× sequential 6/6;
  2× `--test-threads=8` parallel 6/6. Temp pattern
  `vardhan-idempotency-{nanos}-{seq}-{pid}.json` mirrors `conformance.rs:152-164`.
- Full `cargo test --workspace` (normal CI invocation, nohup pid 2292,
  `/tmp/ws_test_missionI.log`): **770 passed / 0 failed** across 106 suites, DONE
  (ran through `raft_l3_1_hardening`; zero `FAILED`/`error[`/`panicked` lines).
- `git diff 4724717..HEAD -- backend/vardhan_idempotency/src/` = empty (production untouched).

## Verdict

1107c3e: Enterprise green (fix confirmed); 4/6 workflows success; Correctness still
running at last poll — **do not label the commit fully green until 39029010085 reaches
a successful terminal state**. 4724717: terminal record is 5 success + 1 explained
failure (fix landed in 1107c3e).
