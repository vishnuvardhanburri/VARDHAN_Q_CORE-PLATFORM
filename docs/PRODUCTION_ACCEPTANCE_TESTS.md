# Production acceptance test evidence — 2026-10-23

**NOT PRODUCTION READY.** Source baseline: `82a12d5dd92613a17cfcacf965fff0d304bfa805`.
Environment: Ubuntu 26.04.1 x86_64; Rust/Cargo 1.99.1 via mise; Node 24.21.0;
Python 3.14.4. Local synthetic fixtures only. No real payment rails or customers.
The image uses its own declared Rust 1.98 builder; see separate image result.

## Commands and observed exits

Commands run from the repository root unless explicitly noted. `mise exec rust@stable --`
selects the installed toolchain. Failed reproduction tests are retained as evidence of
pre-fix defects; they are not current passing gates. Full invocation input hashes and
scratch log locations are retained in workspace-context/validation-record.md outside Git.

| Check | Exact command | Observed result |
|---|---|---|
| baseline-build | `mise exec rust@stable -- cargo build --workspace --locked` | PASS |
| baseline-format | `mise exec rust@stable -- cargo fmt --all -- --check` | PASS |
| baseline-secrets | `bash scripts/check_no_tracked_secrets.sh` | PASS |
| baseline-rustls | `python3 scripts/check_rustls_lock.py` | PASS |
| baseline-tests | `mise exec rust@stable -- cargo test --workspace --locked -- --test-threads=1` | FAIL / exit 124 |
| baseline-clippy | `mise exec rust@stable -- cargo clippy --workspace --all-targets --locked -- -D warnings` | FAIL / exit 101 |
| baseline-console | `node platform_web/test.mjs` | PASS |
| frontend-install | `npm ci --prefix intelligence_plane --ignore-scripts` | PASS |
| baseline-canonical-suite | `mise exec rust@stable -- ./qcore test` | STOPPED duplicate Rust run; doctor failed; service gates outstanding |
| frontend-build | `npm run build --prefix intelligence_plane` | PASS |
| baseline-npm-audit | `npm audit --prefix intelligence_plane --json` | FAIL / exit 1 |
| baseline-python-contracts | `python3 scripts/p1_sdk_contract_check.py && python3 scripts/p1_model_compatibility.py && python3 -m unittest discover -s tests -p industry_planes_contract_test.py` | PASS |
| reproduced-core | `mise exec rust@stable -- cargo test -p core_crypto --lib regression_ -- --test-threads=1` | FAIL / exit 101 |
| frontend-security-update | `npm update --prefix intelligence_plane vite handlebars --ignore-scripts` | PASS |
| reproduced-proxy | `mise exec rust@stable -- cargo test -p proxy_engine --lib regression_ -- --test-threads=1` | FAIL / exit 101 |
| rust-audit | `mise exec rust@stable -- cargo audit` | PASS |
| frontend-audit | `npm audit --prefix intelligence_plane` | PASS |
| frontend-updated-build | `npm run build --prefix intelligence_plane` | PASS |
| frontend-tests | `npm test --prefix intelligence_plane` | PASS |
| fixed-core | `mise exec rust@stable -- cargo test -p core_crypto --lib --locked -- --test-threads=1` | PASS |
| fixed-proxy | `mise exec rust@stable -- cargo test -p proxy_engine --locked -- --test-threads=1` | PASS |
| reproduced-enclave | `mise exec rust@stable -- cargo test -p core_crypto --lib regression_unimplemented_enclave -- --test-threads=1` | INVALID COVERAGE: 0 tests |
| reproduced-reservation | `mise exec rust@stable -- cargo test -p vardhan_receipt --bin vardhan-receipt reservation_regressions -- --test-threads=1` | INVALID COVERAGE: 0 tests |
| reproduced-enclave-actual | `mise exec rust@stable -- cargo test -p core_crypto --lib regression_unimplemented_enclave -- --test-threads=1` | FAIL / exit 101 |
| reproduced-reservation-actual | `mise exec rust@stable -- cargo test -p vardhan_receipt --bin vardhan-receipt reservation_regressions -- --test-threads=1` | FAIL / exit 101 |
| final-core | `mise exec rust@stable -- cargo test -p core_crypto --locked -- --test-threads=1` | PASS |
| fixed-receipt | `mise exec rust@stable -- cargo test -p vardhan_receipt --locked -- --test-threads=1` | FAIL / exit 101 |
| fixed-receipt-rerun | `mise exec rust@stable -- cargo test -p vardhan_receipt --locked -- --test-threads=1` | FAIL / exit 101 |
| production-image | `DOCKER_HOST=unix:///home/vercel-sandbox/runtime/qcore-docker/docker.sock docker build --network host -f docker/Dockerfile.prod -t qcore-security-candidate:local .` | FAIL / exit 1 |
| final-receipt | `mise exec rust@stable -- cargo test -p vardhan_receipt --locked -- --test-threads=1` | PASS |
| final-build | `mise exec rust@stable -- cargo build --workspace --locked` | PASS |
| final-format | `mise exec rust@stable -- cargo fmt --all -- --check` | PASS |
| memory-vault-tests | `mise exec rust@stable -- cargo test -p core_crypto --lib vault --locked -- --test-threads=1` | PASS |
| final-proxy | `mise exec rust@stable -- cargo test -p proxy_engine --locked -- --test-threads=1` | PASS |
| affected-workspace | `mise exec rust@stable -- cargo test --workspace --exclude ha_cluster --locked -- --test-threads=1` | PASS |
| Supplemental unsuppressed Rust audit | `mise exec rust@stable -- cargo audit --file /home/vercel-sandbox/workspace/repos/github.com/vishnuvardhanburri/vardhan_q_core-platform/Cargo.lock --no-fetch --no-yanked --json` | FAIL / exit 1; 8 vulnerabilities, 9 unmaintained warnings |
| review-diff-check | `git diff --check` | PASS |
| deny-advisories | `mise exec rust@stable -- cargo deny check advisories` | PASS |
| production-image-buildkit | `DOCKER_BUILDKIT=1 DOCKER_HOST=unix:///home/vercel-sandbox/runtime/qcore-docker/docker.sock docker build --network host --progress plain -f docker/Dockerfile.prod -t qcore-security-candidate:local .` | PASS |
| deny-licenses | `mise exec rust@stable -- cargo deny check licenses` | FAIL / exit 4 |
| final-ha-suite | `mise exec rust@stable -- cargo test -p ha_cluster --locked -- --test-threads=1` | PASS |
| history-secret-scan | `gitleaks detect --source . --log-opts=--all --redact --no-banner --log-level error --report-format json --report-path /tmp/qcore-validation/history-secrets.json` | FAIL / exit 1 |
| review-fix-tests | `mise exec rust@stable -- cargo test -p core_crypto --lib --locked -- --test-threads=1 && mise exec rust@stable -- cargo test -p vardhan_receipt --bin vardhan-receipt reservation_regressions --locked -- --test-threads=1` | PASS |
| proxy-release-gate | `mise exec rust@stable -- cargo test --release -p proxy_engine --lib release_gate_ --locked -- --test-threads=1` | PASS |
| final-strict-clippy | `mise exec rust@stable -- cargo clippy --workspace --all-targets --locked -- -D warnings` | FAIL / exit 101 |
| affected-ha-transport | `mise exec rust@stable -- cargo test -p ha_cluster --test transport_tests --locked -- --test-threads=1` | PASS |
| image-cli-smoke | `DOCKER_HOST=unix:///home/vercel-sandbox/runtime/qcore-docker/docker.sock docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --entrypoint /usr/local/bin/pq_verify qcore-security-candidate:local --help` | PASS |
| final-image | `DOCKER_BUILDKIT=1 DOCKER_HOST=unix:///home/vercel-sandbox/runtime/qcore-docker/docker.sock docker build --network host --progress plain -f docker/Dockerfile.prod -t qcore-security-candidate:local .` | PASS |
| CodeRabbit review pass 1 | `coderabbit review --agent -t uncommitted` | COMPLETED / exit 0; 2 minor findings, repaired |
| final-image-smoke | `python3 /tmp/qcore-validation/image_smoke.py` | FAIL / exit 1 |
| release-candidate-build | `mise exec rust@stable -- cargo build --workspace --locked` | PASS |
| release-candidate-format | `mise exec rust@stable -- cargo fmt --all -- --check` | PASS |
| final-image-smoke-corrected | `python3 /tmp/qcore-validation/image_smoke.py` | FAIL / exit 1 |
| final-image-boundaries | `python3 /tmp/qcore-validation/image_smoke.py` | FAIL / exit 1 |
| image-bootstrap-boundaries | `python3 /tmp/qcore-validation/image_smoke.py` | PASS |
| review-core-regressions | `mise exec rust@stable -- cargo test -p core_crypto --lib --locked` | PASS |
| review-receipt-suite | `mise exec rust@stable -- cargo test -p vardhan_receipt --locked` | PASS |
| reviewed-image | `DOCKER_BUILDKIT=1 DOCKER_HOST=unix:///home/vercel-sandbox/runtime/qcore-docker/docker.sock docker build --network host --progress plain -f docker/Dockerfile.prod -t qcore-security-candidate:local .` | PASS |
| image-smoke-script | `DOCKER_HOST=unix:///home/vercel-sandbox/runtime/qcore-docker/docker.sock python3 scripts/security_candidate_image_smoke.py` | PASS |
| CodeRabbit review pass 2 | `coderabbit review --agent -t uncommitted` | COMPLETED / exit 0; 4 minor findings, repaired |
| final-receipt-regressions | `mise exec rust@stable -- cargo test -p vardhan_receipt --locked` | PASS |
| final-format-check | `mise exec rust@stable -- cargo fmt --all -- --check` | PASS |
| prepared-environment-doctor | `DOCKER_HOST=unix:///home/vercel-sandbox/runtime/qcore-docker/docker.sock mise exec rust@stable -- ./qcore doctor` | PASS |
| reviewed-image-smoke | `DOCKER_HOST=unix:///home/vercel-sandbox/runtime/qcore-docker/docker.sock python3 scripts/security_candidate_image_smoke.py` | PASS |

## Additional observed checks

- `mise install rust@stable`: exit 0, installed Rust 1.99.1.
- `mise exec rust@stable -- cargo install cargo-audit --locked`: exit 0, cargo-audit 0.22.2.
- From `/tmp/qcore-validation`: `mise exec rust@stable -- cargo audit --file /home/vercel-sandbox/workspace/repos/github.com/vishnuvardhanburri/vardhan_q_core-platform/Cargo.lock --no-fetch --no-yanked --json`: exit 1; bypassed repository exclusions, 8 vulnerabilities and 9 unmaintained warnings. Yanked-crate check was excluded only from this supplemental unfiltered diagnostic; normal audit ran with its default checks.
- Initial implementation compile failed on a new XML helper lifetime; corrected.
- Initial receipt repair compile failed because a validation return was inserted into the CLI unit-returning branch; corrected.
- First receipt repair test pass found a legacy marker-content incompatibility (SEALED padding); restored exact SEALED bytes, then all 95 receipt tests passed.
- Baseline workspace build, formatting, filename guard, rustls floor, console and frontend checks passed.
- Baseline Clippy with `-D warnings` failed on 22 pre-existing core errors; no lint suppression added.
- Baseline workspace test command exceeded the 900-second execution bound while in HA checkpoint tests. Completed groups are not evidence that the whole suite passed.
- After shared crypto changes, broad affected coverage reruns the workspace outside ha_cluster and the HA transport integration target. The full HA suite was subsequently restarted with a 3600-second bound; its terminal result is listed above. Full deployment DR/soak acceptance remains separate.

## Reproduction and current scope

Eleven negative regressions reproduced failure before their repairs: seven core cases
(expiry, malformed XML, unsigned metadata, invalid dates, timezone/leap arithmetic,
KDF ambiguity, poisoned quarantine), unsigned-version handshake, enclave false success,
and two receipt reservation cases. Additional tests cover XML limits/escaping/namespaces,
missing/duplicate payment fields and malformed vault secret lengths. Repeated tests reuse
unchanged frontend/SDK results when their inputs remain equivalent.

No independent performance or 280-microsecond benchmark was run. No independent fuzz/soak campaign,
physical power-loss test, deployment identity/KMS drill,
customer acceptance or official ISO interoperability was completed. Missing mandatory
evidence blocks release; an empty test filter is not a passing validation result.

## Final test counts and artifact boundary

Broad affected workspace run: 650 passed / 0 failed / 2 pre-existing ignored.
Full HA run: 228 passed / 0 failed / 0 ignored, including the 14-case failure
target (751.61 seconds). This duration is a test-run observation, not recovery latency.
Later focused core library: 84 passed; receipt: 95 main-binary + 2 other target tests.
Frontend: 101 tests across 38 files. Counts overlap across reruns.

Final image ID: `sha256:6d9f8001458c549e1e350027992d471f1b7c23054cb8bed3b2913d018b139702`.
The repository smoke script passed on that image. Earlier scratch assertions failed
because startup stops at the approved binary-hash/bootstrap identity checks before
later configuration guards. Those failures were corrected by inspecting startup order;
no production guard was bypassed. All 22 matrix rows and their named test references
were also checked (22 unique rows, zero missing references).

## Review-discovered release fixture regression

`mise exec rust@stable -- cargo test --release -p proxy_engine --test integration_test --locked`
first reproduced 2 failures / 7 passes (exit 101): two test servers lacked the
registry required by the strengthened release startup gate. After registering the
synthetic clients, the same command passed all 9 tests (exit 0).
`mise exec rust@stable -- cargo test -p proxy_engine --test integration_test --locked`
also passed 9 tests (exit 0). `mise exec rust@stable -- cargo fmt --all -- --check`
passed again (exit 0). Only test setup changed; production checks remain enforced.

## Final error-classification check

`mise exec rust@stable -- cargo test -p core_crypto --lib malformed_payment_input_is_not_an_internal_fault --locked`
reproduced the classification issue (1 failure, exit 101). After the fix,
`mise exec rust@stable -- cargo test -p core_crypto --locked` passed: 84 library,
17 smoke-binary and 6 algorithm self-test cases (exit 0). Formatting passed again.
The new InvalidField enum variant and compatibility impact are documented in the ISO profile.

The final error-classification patch was rebuilt with the same recorded Docker
build command (`final-reviewed-image`, exit 0). The repository container smoke
command was rerun on that image (`final-reviewed-image-smoke`, exit 0). This supersedes
the earlier image ID for the final runtime patch. Three CodeRabbit review passes
completed with 2, 4 and 2 minor findings; all were addressed and affected tests rerun.
