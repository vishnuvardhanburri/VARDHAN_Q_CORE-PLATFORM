# 22-point finding trust gate — authoritative implementation matrix

**Scope: VerifiedFindingContract structural validation and finding sealing only.**
The previous claim that these checks establish complete financial authorization and
cryptographic evidence integrity was incorrect. Required full guarantees remain release
blockers; they were not silently replaced by weaker passing tests.

All paths below are under `backend/vardhan_receipt/src`. INV-01–20 consume untrusted
contract fields; their values are not trusted merely because a field is present. INV-21/22
trust an exclusively owned local storage directory. Separate policy authority resolves
tenant/actor permission. Each row's objective is to reject the invalid condition named.

Failure response: INV-01–20 return descriptive validator errors and `REJECTED_TRUST_BOUNDARY`
before signing; INV-21/22 return replay/conflict denial. Storage/audit uncertainty after
signing returns `OUTCOME_UNKNOWN`. Validation rejection does **not** currently produce a
guaranteed durable per-invariant audit record. This missing audit evidence applies to
all rows. Positive coverage uses `test_a_valid_contract_accepts` and
`test_f007_valid_contract_passes_all_checks`; no distinct positive
case for every trusted relationship exists. Negative tests below are exact existing test
names. Integration coverage is the receipt binary e2e tests and control-plane receipt
trust-boundary tests; missing evidence-resolution integration applies to all relevant rows.

| ID / objective | Exact implemented acceptance condition | Function / source | Negative test | Remaining coverage/security limitation |
|---|---|---|---|---|
| INV-01 Schema version | schema in {1.0,1.1} | trust_boundary.rs / validate | `test_inv01_schema_version_invalid_rejects` | structural only |
| INV-02 Tenant ID presence | organization_id nonempty | trust_boundary.rs / validate | `test_inv02_empty_organization_id_rejects` | not identity authentication |
| INV-03 Engine/run presence | engine_id and run_id nonempty | trust_boundary.rs / validate | `test_inv03_empty_intelligence_identity_rejects` | not trusted producer identity |
| INV-04 Domain presence | canonical_domain nonempty | trust_boundary.rs / validate | `test_inv04_empty_canonical_domain_rejects` | not domain ownership |
| INV-05 Resource identity | canonical_url and entry_point_id nonempty | trust_boundary.rs / validate | `test_inv05_empty_resource_identity_rejects` | not resource ownership |
| INV-06 Finding ID presence | finding_id nonempty (storage path also bounded) | trust_boundary.rs / validate | `test_inv06_empty_finding_id_rejects` | global CLI scope; tenant scope missing |
| INV-07 Evidence presence | evidence_refs nonempty | trust_boundary.rs / validate | `test_inv07_empty_evidence_refs_rejects` | no authoritative evidence resolver |
| INV-08 Digest syntax | each hash is 64 ASCII hex characters | trust_boundary.rs / validate | `test_inv08_invalid_evidence_content_hash_rejects` | NO underlying evidence bytes/hash recomputation |
| INV-09 Origin presence | each evidence_origin nonempty | trust_boundary.rs / validate | `test_inv09_empty_evidence_origin_rejects` | not attested provenance |
| INV-10 Temporal label | each temporal_status == CURRENT | trust_boundary.rs / validate | `test_inv10_historical_evidence_rejects` | not timestamp freshness |
| INV-11 Expectation link | expectation_id nonempty | trust_boundary.rs / validate | `test_inv11_empty_expectation_linkage_rejects` | existence/authorization unchecked |
| INV-12 Observation links | observation_ids nonempty | trust_boundary.rs / validate | `test_inv12_empty_observation_linkage_rejects` | members/existence unchecked |
| INV-13 Differential link | differential_id nonempty | trust_boundary.rs / validate | `test_inv13_empty_differential_linkage_rejects` | existence/relationship unchecked |
| INV-14 Verification links | hypothesis_id and verification_contract_id nonempty | trust_boundary.rs / validate | `test_inv14_empty_verification_linkage_rejects` | existence/relationship unchecked |
| INV-15 Differential state | differential_state == CONFIRMED_MISMATCH | trust_boundary.rs / validate | `test_inv15_differential_state_not_confirmed_mismatch_rejects` | caller assertion |
| INV-16 Materiality | materiality in HIGH/MEDIUM/LOW | trust_boundary.rs / validate | `test_inv16_invalid_materiality_rejects` | caller assertion |
| INV-17 Contradictions | contradictory_evidence_ids empty | trust_boundary.rs / validate | `test_inv17_contradictory_evidence_rejects` | caller can omit contradictions |
| INV-18 Action allowlist | decision_candidate == SEAL_VERIFIED_FINDING | trust_boundary.rs / validate | `test_inv18_unauthorized_action_candidate_rejects` | trusted actor authorization separate |
| INV-19 Policy name | policy_reference == VARDHAN_CORE_INTELLIGENCE_POLICY_V1 | trust_boundary.rs / validate | `test_inv19_unregistered_policy_reference_rejects` | fixed string, not dynamic registry lookup |
| INV-20 Assessment declaration | requires_authorized_assessment implies authorized_by present | trust_boundary.rs / validate | `test_inv20_missing_authorized_by_when_required_rejects` | request flag can disable declaration; no trusted assessment check |
| INV-21 Committed replay | no committed flag | main.rs / is_finding_already_sealed | `test_inv21_durable_replay_rejects` | single-filesystem durability assumptions |
| INV-22 Exclusive reservation | exclusive reservation plus committed-state recheck | main.rs / reserve_finding | `test_inv22_concurrent_duplicate_reservation_single_winner` | cross-node authority and crash recovery unproven |

## Required completion

Provide an authenticated evidence store/resolver keyed by tenant and evidence ID; retrieve
immutable bytes with bounded size and trusted provenance, compute SHA-256 and compare to
the commitment. Do not fetch arbitrary request-supplied URLs (SSRF boundary). Resolve
policy/assessment/transaction/finding relationships through trusted stores, including
actual existence and permitted ownership. Require trusted authorization irrespective of
request flags. Add individual positive/negative/integration tests and durable rejection
events. These controls are **NOT IMPLEMENTED** by the existing shape validator.

Payment invariants are specified separately in PAYMENT_TRANSACTION_INVARIANTS.md.
