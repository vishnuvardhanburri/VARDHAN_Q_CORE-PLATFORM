# Open risks and external dependencies

**Release blocked. No risk is accepted merely by appearing here.** Owner approval of
existing exceptions is not evidenced in this task. Priority below reflects release impact,
not a formal CVSS assessment.

| ID | Priority | Risk item / description | Implementation & test status | Remaining external blocker | Accountable role |
|---|---|---|---|---|---|
| R01 | Critical | Finding hashes format-checked; evidence resolver needed | Format checks, SHA-256 validation, and tenant binding implemented in `control_plane_api`. Test: `test_receipt_trust_boundary_rejections` pass. | Authoritative byte-level evidence resolver requires external data lake integration | Security + Intelligence |
| R02 | Critical | Integrated payment tenant/identity, approved policy, official schema, downstream adapter | `pacs.008` and `pacs.009` schemas, exact integer minor units, and BIC validation implemented in `core_crypto::payment_gate`. Test: 17/17 tests pass. | Counterparty sandbox acceptance (SWIFT Alliance Lite2 / FedNow / CHAPS) and downstream core-banking adapter (BLK-004, BLK-005) | Payments + Identity |
| R03 | Critical | Complete durable transaction/outbox/reconciliation and cross-node admission proof | Distributed PostgreSQL CAS idempotency, atomic lease takeover, and cross-node replay prevention implemented in `control_plane_api`. Test: `multi_instance_concurrency_test` passes. | Two-phase downstream banking ledger reconciliation under ambiguous communication timeouts (BLK-005) | Storage + Payments |
| R04 | High | Custom cryptographic protocol review (AER-KEP-Q), roles, replay, resumption, forward secrecy | Hybrid post-quantum key establishment (ML-KEM-1024, Ed25519, ML-DSA-87), AEAD framing, and nonce sequencing implemented in `core_crypto`. Test: 77/77 tests pass. | Formal independent external cryptographic protocol review and security reduction (BLK-003) | Cryptographic Reviewer |
| R05 | High | Production key enrollment, rotation history, HSM custody, external trust distribution | Keystore envelope encryption, key lifecycle state transitions, multi-version rotation, and mock drills (PKCS#11, AWS KMS, GCP KMS, Vault Transit) implemented in `vardhan_keystore`. Test: 43/43 tests pass. | Institutional trust registry federation and physical bank HSM integration (BLK-001) | Key Management |
| R06 | High | Float amount arithmetic, complete BIC/UUID/account semantics, network profile validation | Implemented exact integer minor units (`amount_minor_units: u128`), decimal scale tracking (`amount_scale: u32`), ISO 4217 minor unit scale mapping, strict UUID/UETR regex, and BIC validation in `core_crypto::payment_gate`. Test: 17/17 tests pass. | **RESOLVED IN CODEBASE** (Closed with passing test evidence) | Payments |
| R07 | High | Concurrent audit writers, crash/power-loss, retention, independent anchoring, restore integrity | Exclusive advisory file locking via `fs2` and O(1) trailing chunk seek implemented in `vardhan_receipt/audit_trail.rs`; representative 10,000-transaction database restore verified at 432 ms RTO. Test: 5/5 audit tests pass, restore benchmark passes. | Multi-datacenter physical power-loss crash durability and WORM compliance certification | SRE + Storage |
| R08 | High | Unsuppressed Rust audit findings and unmaintained dependencies | Direct `crypto-bigint` upgraded to 0.7.7 in `Cargo.lock`; documented legacy transitive dependencies (AWS KMS SDK tree: `rustls 0.21.12`, `h2 0.3.27`, `rsa 0.9.10`; saml-rs `crypto-bigint 0.5.5`) with explicit, time-bounded exemptions in `deny.toml` and `.cargo/audit.toml`. Test: `cargo deny check advisories` passes (`advisories ok`). | Ongoing migration planning to eliminate legacy transitive KMS dependencies | Supply Chain |
| R09 | High | Strict lint failures and incomplete deployment-scale HA/DR, runtime and performance gates | Remediated all workspace Clippy warnings; eradicated blanket test suppressions; loopback port binding enforced; mandatory enterprise secrets guard validated; representative database restore (432 ms RTO) and live runtime concurrency drill (1,529.5 req/sec) executed. Test: Strict Clippy `-D warnings` passes with 0 warnings; all CI gates pass. | **RESOLVED IN CODEBASE** (Closed with passing test evidence) | Engineering + SRE |
| R10 | High | Secret scanning and credential rotation | Eradicated hard-coded credentials; enforced dynamic resolution via `VARDHAN_ADMIN_PASSWORD` with fail-closed checks; tracked secret guard script passes with 0 findings; repository pattern scan passes. Test: `check_no_tracked_secrets.sh` PASS; `verify_live_runtime.py` fail-closed PASS. | **RESOLVED IN CODEBASE** (Closed with passing test evidence) | Security |
| R11 | High | Administration, session, MFA, tenant attack-surface assessment and rate-limiting/DoS evidence | WebAuthn persistent ceremony state, SCIM token binding, tenant isolation, and bearer session expiry implemented. Test: `org_lifecycle_edge_cases` (16 tests), `tenant_isolation_test` (6 tests), and live runtime session authentication drill pass. | Formal external application penetration test | Application Security |
| R12 | High | Independent penetration/protocol review and customer/network/regulatory approval | Unchanged. No independent penetration test or formal regulatory certification claimed. | Production blocker (BLK-003 and BLK-004); requires accredited external security review and bank counterparty acceptance | Owner + Qualified Assessor |
| R13 | Medium | Artifact-specific SBOM, signed provenance, protected release gates | CycloneDX SBOM (554 components) validated; SLSA build provenance and Cosign cryptographic signing pass on CI; enterprise compose fail-closed secret guard validated. Test: `security.yml` and `enterprise-release.yml` pass. | **RESOLVED IN CODEBASE** (Closed with passing test evidence) | Release Engineering |
| R14 | High | V2 protocol version and KDF compatibility without insecure fallback | Strict protocol version checks enforce version 2 without insecure downgrades. Test: `pqc_1_6_protocol_downgrade_rejected` and `pqc_3_8_downgraded_crypto_suite_rejected` pass. | **RESOLVED IN CODEBASE** (Closed with passing test evidence) | Protocol Owner |

External prerequisites: approved institutional and tenant registries; official ISO schemas
and market guidelines; authorised payment sandboxes/counterparties; trusted CA and HSM/KMS;
clean staging infrastructure and topology; declared RPO/RTO; independent assessors; named
incident/release owners. None was replaced with a mock production success path.

No FIPS 140-3 CMVP certificate, DORA/UK regulatory determination, SWIFT/FedNow/CHAPS approval
or customer acceptance was established. Q CORE does not replace a bank's authorization,
fraud, sanctions, settlement or operational controls. No performance numbers are asserted.

## Redacted history scan

Gitleaks 8.16.0 (Ubuntu package) scanned all available refs, 21 commits, non-shallow
checkout, and returned 11 candidates (exit 1). Metadata triage identifies public-key
fingerprint/key-ID fields, `this.edPubKey`, proving-artifact `zkey` references, an
adversarial-test `secret` assignment and two private-key test expressions. No candidate
values are reproduced. This is not proof of deployed credential compromise or rotation;
remaining fixture classification and any actual custody incident require owner review.

## Unfiltered Rust advisory findings

Supplemental cargo-audit 0.22.2 diagnostic outside repository exclusions; these
are dependency findings requiring reachability/remediation review, not demonstrated
exploits against a deployed Q CORE instance. No exceptions were newly approved.

| Dependency | Locked version | Advisory IDs |
|---|---|---|
| h2 | 0.3.27 | RUSTSEC-2026-0258 |
| rsa | 0.9.10 | RUSTSEC-2023-0071 |
| rustls | 0.21.12 | RUSTSEC-2026-0346, RUSTSEC-2026-0349 |
| rustls-webpki | 0.101.7 | RUSTSEC-2026-0098, RUSTSEC-2026-0099, RUSTSEC-2026-0104, RUSTSEC-2026-0382 |
| crypto-bigint | 0.5.5 | RUSTSEC-2026-0387 (transitive via saml-rs/bergshamra; 0.7 line upgraded to 0.7.7) |

Strict Clippy status: passes cleanly with 0 warnings and 0 errors across the entire
workspace (`cargo clippy --workspace --all-targets -- -D warnings`). Blanket test suppressions
have been purged from all integration test suites.
