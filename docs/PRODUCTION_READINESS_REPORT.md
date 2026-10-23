# Production readiness report — security hardening candidate

## 1. Revision and acceptance

Reviewed source: **82a12d5dd92613a17cfcacf965fff0d304bfa805** (freshly fetched main).
Changes are on `coderabbit/production-readiness-security-hardening/80b9f4f7`.
**Production acceptance: NOT PRODUCTION READY.** This is a reviewable hardening candidate,
not an approved production release. No release was published and no live deployment occurred.

## 2. Priority changes, root causes and impact

| Priority | Issue / root cause | Repair and compatibility impact |
|---|---|---|
| High | HELLO accepts key-only legacy signature, leaving versions unauthenticated | remove fallback; exact frame length; old insecure peers rejected |
| High | Proxy defaults to development and can fabricate ACK | default Production, no generic ACK, mandatory handler, registry enforced in release builds |
| High | Institutional key expiry stored but unused | reject expired/inactive/inconsistent registry identity; no claim of complete tenant/role key enrollment |
| High | XML substring parsing and digest-only signatures permit ambiguity/metadata changes | bounded namespace-aware parser, writer escaping, V2 complete-document/context binding; V1 and unsupported profiles rejected |
| High | Payment date arithmetic accepts invalid calendar/offsets; placeholder accounts | RFC3339 conversion, exact field paths and required accounts; f64 payment precision remains blocked |
| High | Variable KDF context/ID concatenation collides | length-prefix inputs and V2 domain; derived keys change and require coordinated retirement |
| High | Quarantine lookup returns false on lock poisoning | deny on unknown monitoring state |
| High | Enclave stub returns unchanged input as successful execution | explicit unavailable error until real attested backend exists |
| High | File reservation races committed state and drops barrier after commit failure | synced exclusive reservation, committed-state recheck, atomic rename/directory sync, retained barrier and OUTCOME_UNKNOWN |
| High | Audit append errors still return success | return OUTCOME_UNKNOWN with barrier retained; multiwriter atomic audit still unproven |
| Medium | Malformed stored secret length panics; DEK plaintext temporaries not zeroizing | checked lengths and RAII zeroization across error/success paths |
| High | Frontend lockfile includes Vite/Handlebars advisories | compatible dependency update; npm audit now zero findings, frontend build/test passed |
| Medium | Production image copies nonexistent library executable; CI rewrites formatting | package pq_verify, locked build, enforce fmt --check |
| Evidence | README/spec overstate security, compliance, recovery and interoperability | distinguish implementation, internal testing, missing proof and external assurance |

Important sources: core_crypto/{iso20022_pqc,payment_xml,payment_gate,transaction_bound_kdf,
self_healing_epoch,enclave,vault,lib}.rs; proxy_engine; vardhan_receipt/src/main.rs;
Dockerfile.prod; CI workflows; intelligence_plane/package-lock.json; README and readiness docs.

## 3. Commands and tests

See [exact commands and results](PRODUCTION_ACCEPTANCE_TESTS.md). Failed baseline,
reproduction and intermediate checks are preserved. The broad baseline test run timed out;
strict Clippy stops at 20 core errors. No full green CI claim is made. Current targeted security checks
are distinguished from broad suite and operational evidence.

## 4. Supply chain

Normal cargo audit passes under existing repository exclusions. A supplemental audit
outside those exclusions reports **8 vulnerabilities / 9 unmaintained warnings**:
h2 0.3.27, rsa 0.9.10, rustls 0.21.12 and rustls-webpki 0.101.7. The exact advisory IDs
are in the acceptance evidence/risk register. Existing exceptions were not approved by
this task. Corrected the false claim that serde_cbor was only a non-production dependency:
core_crypto uses it for rotation payloads. No crypto library was automatically replaced.
Npm Vite/Handlebars findings were repaired and verified. License checks fail without an approved policy. A redacted scan of all 21 available commits found 11 candidates, largely public identifiers/artifact references/test expressions; no rotation or clean-history claim is made. Filename secret guard and rustls
floor checks pass; neither establishes a clean repository history or deployed configuration.
Artifact-specific SBOM/provenance and license-policy approval remain required.

## 5. Cryptographic and operational boundaries

No new cryptographic primitive or parameter set. ISO V2 signs domain/context and the entire
validated parsed document; KDF V2 removes encoding ambiguity. Both require coordinated
migration; no fallback to insecure legacy verification. Registry-free verification remains
consistency-only. No tenant/payment authorisation, forward secrecy or quantum-safe product
guarantee follows from primitive calls. Independent protocol/key-lifecycle review is pending.

Deployment fixes address build/check defects. HA/DR and incident response documents specify
procedures requiring execution and owner assignment. No RPO/RTO or performance result was
measured; full recovery cannot be inferred from a local epoch switch. No real payment traffic
was sent. Local Docker build results are distinct from staging/production acceptance.

## 6. Remaining work and approvals

See [open risks](OPEN_RISKS_AND_EXTERNAL_DEPENDENCIES.md): authoritative finding evidence
resolution, official ISO schema/market profiles, full payment identity/policy/adapter,
exact-decimal financial validation, durable distributed execution and reconciliation,
concurrent audit/DR evidence, production trust/key custody, remaining dependency advisories,
complete access-control assessment and secret-scan triage, strict lint and all release gates.
These are not accepted risks and are not marked complete. Independent security/cryptographic
assessment, qualified regulatory applicability review, network/counterparty acceptance and
explicit owner deployment/release approval are still required.

| Evidence class | Status |
|---|---|
| IMPLEMENTED | scoped repairs listed above, committed source and documentation |
| TESTED | only command-specific results in acceptance report |
| INDEPENDENTLY REVIEWED | external protocol/pentest assessment not established; automated code review separately recorded |
| CERTIFIED | no applicable certification established |
| NOT YET PROVEN | all open production, distributed recovery, interoperability and performance requirements |

## 7. Final internal validation summary

- Workspace build and formatting passed with the documented toolchain.
- Broad workspace tests excluding HA: 650 passed, 2 existing ignored tests.
- Full HA suite: 228 passed, zero failed/ignored across 21 executable targets plus doc tests.
- Subsequent focused core library run: 84 passed (plus 17 smoke-binary and 6 algorithm self-test cases); receipt targets: 97 passed (95 in the main binary). These overlap the broad suite and must not be summed as unique tests.
- Proxy debug tests: 23 library and 9 integration; release-mode registry enforcement: 1 passed.
- Frontend: build and 101 tests in 38 files passed; npm audit reports zero findings.
- Local candidate image built from the final runtime code: `sha256:6d9f8001458c549e1e350027992d471f1b7c23054cb8bed3b2913d018b139702`. This is a local image ID, not signed registry provenance.
- Container boundary smoke passed: UID 10001, verifier CLI, missing receipt hash rejection and missing administrator bootstrap identity rejection. No configured service or financial lifecycle was deployed.
- Environment doctor passed after Rust/Docker preparation.
- Strict lint and license gates fail; unsuppressed dependency advisories and history-scan candidates remain unresolved. Earlier timeout, reproduction and smoke-expectation failures are retained in the acceptance record.

BuildKit warns about `VARDHAN_AUTH_CONFIG_PATH` by variable name; its value is a configuration path, not a credential. Compiler warnings remain. Source allowlisting excludes runtime data and local secrets from the builder context.

## 8. Automated review and change audit

CodeRabbit completed three review passes: **2, 4 and 2 minor findings**, respectively.
The first identified discarded test commit results and a stale constructor comment;
the second covered fixture expiry and shared environment/directory isolation; the third
identified missing release-mode test registries and malformed input classified as an
internal error. All reported issues were addressed and affected tests rerun. The last
pass had two findings; no zero-finding final pass or independent security approval is claimed.

Implementation commits:

- `c607a09`: crypto/XML/payment validation and failure handling.
- `c71ac3c`: ingress trust, execution handler and receipt durability.
- `004304e`: frontend dependency fixes, image inputs, CI and smoke script.

The documentation commit completes the audit trail. No critical/high release blocker
in the risk register is considered accepted or complete merely because these commits exist.
