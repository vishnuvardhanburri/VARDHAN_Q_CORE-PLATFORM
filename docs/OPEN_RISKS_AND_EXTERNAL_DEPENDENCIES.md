# Open risks and external dependencies

**Release blocked. No risk is accepted merely by appearing here.** Owner approval of
existing exceptions is not evidenced in this task. Priority below reflects release impact,
not a formal CVSS assessment.

| ID | Priority | Blocker / evidence needed | Proposed accountable role |
|---|---|---|---|
| R01 | Critical | Finding hashes are format-checked, not recomputed from authoritative evidence; provenance/reference authorization resolver needed | security + intelligence |
| R02 | Critical | Integrated payment tenant/application/role identity, approved policy, official schema and downstream adapter missing | payments + identity |
| R03 | Critical | Complete durable transaction/outbox/reconciliation and cross-node admission proof missing | storage + payments |
| R04 | High | Custom handshake complete transcript/roles/replay/resumption/forward-secrecy review outstanding; unauthenticated development APIs remain | crypto reviewer |
| R05 | High | Production key enrollment, not-before/rotation/revocation history, HSM custody and external trust distribution incomplete | key management |
| R06 | High | Float amount arithmetic, complete BIC/UUID/account semantics and network profile validation remain | payments |
| R07 | High | Concurrent audit writers, crash/physical power-loss, retention, independent anchoring and restore integrity unproven | SRE + storage |
| R08 | High | Unsuppressed Rust audit reports 8 vulnerabilities and 9 unmaintained warnings; maintained PQ dependency migration needs expert compatibility review | supply chain |
| R09 | High | Strict lint failures and incomplete deployment-scale HA/DR, runtime and performance gates | engineering + SRE |
| R10 | High | Historical secret scanning/rotation evidence and access-controlled log review not established by filename guard | security |
| R11 | High | Full administration/MFA/session/CSRF/tenant attack-surface assessment and rate-limit/DoS evidence incomplete | application security |
| R12 | High | Independent penetration/protocol review and customer/network/regulatory approval not performed | owner + qualified assessor |
| R13 | Medium | Artifact-specific SBOM/license validation, signed provenance, protected release gates and rollback exercises incomplete | release engineering |
| R14 | High | V2 ISO/KDF compatibility requires coordinated peer rollout; no insecure backward fallback permitted | protocol owner |

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
