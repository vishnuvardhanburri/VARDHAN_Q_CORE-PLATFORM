# Clean-Room Verification — Phase 9 Evidence Record

> Docs-only record. No source changes were made in this phase.

## Header

| Field | Value |
|---|---|
| Base repo (working dir) | `/Users/vishnuvardhanburri/antigravity/VARDHAN_Q_CORE-PLATFORM-main` |
| Base HEAD | `e6ffb8a` (clean, synced) |
| Clean-room path | `/Users/vishnuvardhanburri/antigravity/VARDHAN_Q_CORE_CLEANROOM` |
| Clean-room SHA | `e6ffb8aff0d39866468e63dedfb52576a3b2231c` |
| Clean-room git status | clean (after `adv_cp.log` removal — verified by leader) |
| Date | 2026-10-16 |
| Platform | darwin / arm64 |
| Docker | No docker (not used; Darwin sim environment) |

## Method

1. Fresh clone into `VARDHAN_Q_CORE_CLEANROOM` at SHA `e6ffb8a` /
   `e6ffb8aff0d39866468e63dedfb52576a3b2231c`.
2. Leader-verified clean state: `adv_cp.log` artifact removed, `git status` clean.
3. Standard `cargo build` / `cargo test` runs against the committed `Cargo.lock`
   (no `--frozen` flag claimed; lockfile-driven standard toolchain resolution).
4. Leader executed all verification steps in the clean-room; results below are
   transcribed EXACTLY as leader-verified — they were not re-run for this doc.
5. Frontend was intentionally NOT RUN in the clean-room (separate repo concern;
   directory exists with `node_modules` + `pnpm-lock.yaml`, but no
   install/build was performed).
6. No services were left running after verification (see Cleanup).

## Results (leader-verified, transcribed exactly — do not re-run)

| # | Check | Command / scope | Exit | Result |
|---|---|---|---|---|
| 1b | Guard | guard check | 0 | PASS |
| 1c | rustls | rustls floor check | 0 | PASS (0.23.46 floor, 0.21.12 KMS exception) |
| 1d | fmt | `cargo fmt --check`-equivalent | 0 | PASS |
| 2a | Build (release) | `vardhan_receipt` release build | 0 | PASS (26.49s) |
| 2b | Build (release) | `receipt_generator` build | 0 | PASS (32.29s, needed by adversarial script) |
| 3 | Lab | lab suite, 5/5 REAL | 0 | PASS (`SIMULATED=1`, `ENFORCE_MODE=sim`) |
| 4a | Idempotency | idempotency suite | 0 | 7+7+6+0 passed, 0 failed |
| 4b | Receipt + verifier | receipt + verifier suites | 0 | 2+69+1+0+0 passed, 0 failed |
| 5 | Frontend | — | — | NOT RUN in clean-room (different repo, no install/build; dir exists with `node_modules` + `pnpm-lock.yaml`) |
| 6 | Contract | `org_lifecycle_edge_cases` | 0 | 13 passed, 0 failed (9.03s) |
| 7 | Adversarial security | `adversarial_security_test.sh` | 0 | 10/10 PASS — "ALL ADVERSARIAL SECURITY CHECKS PASSED" (after building `receipt_generator`; temp pw/data/server cleaned up) |
| 8 | qcore status | `qcore status` | — | stopped-state as expected + Darwin sim notice; no services started |

Notes:

- Steps 2b (`receipt_generator` build) was a prerequisite for step 7
  (adversarial script); both are recorded separately to preserve ordering.
- Step 5 is explicitly NOT RUN — it is not a pass, not a fail, and not skipped
  for cause; it is out of scope for this clean-room pass (see NOT RUN list).
- Step 8 is a state assertion (stopped-state as expected), not a test suite.

## NOT RUN (explicitly out of scope for this clean-room pass)

- Frontend build (`pnpm install` / `pnpm build` or equivalent).
- Fuzz runs (cargo-fuzz / prolonged fuzz targets).
- `docker compose up` (no docker on this Darwin host).
- Multi-node deployment verification.
- Perf / soak runs (latency, throughput, endurance).

Any claim about the above requires a separate evidence record; absence here
implies nothing about their status.

## Cleanup

- `adv_cp.log` removed from the clean-room; `git status` verified clean.
- Adversarial-run server process killed after step 7.
- Temporary password files, temporary data directories, and ephemeral server
  artifacts from the adversarial run removed.
- No background services left running (`qcore status` confirms stopped-state).
- Clean-room left at verified SHA `e6ffb8aff0d39866468e63dedfb52576a3b2231c`
  with `git status` clean.

## Non-equivalence note

CI green ≠ clean-room. A green CI pipeline and this clean-room pass are
independent signals: CI attests the pinned pipeline environment, while this
document attests a fresh-clone, lockfile-driven verification on
darwin/arm64 on 2026-10-16 without docker. Neither subsumes the other.
This doc is the clean-room evidence for Phase 9; do not cite CI status as a
substitute, and do not cite this doc as CI evidence.

---

*End of Phase 9 clean-room evidence record. Docs-only; no source changes.*

## File provenance

- Authored as a Phase 9 docs-only evidence record; no `src/`, `tests/`,
  workflow, or config files were modified in this phase.
- All result figures above are leader-verified values transcribed verbatim;
  this file's author did not re-execute any check, build, or suite.
- Any future clean-room re-verification (different SHA, platform, or date)
  must create a new dated record or revision — do not silently overwrite
  the figures above.
- Single untracked file added by this phase: `docs/CLEAN_ROOM_VERIFICATION.md`.
