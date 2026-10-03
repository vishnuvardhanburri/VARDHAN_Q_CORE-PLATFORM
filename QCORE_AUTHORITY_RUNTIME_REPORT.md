# Q-Core Authority Runtime Report

## IMPLEMENTED
1. **Explicit Policy Registry**: Created a static, compile-time `PolicyRegistry` serving as the definitive source of truth for governed policies. No fallback, default, or wildcard policies exist.
2. **Explicit Tenant Registry**: Created a synchronous `TenantRegistry` modeling provisioned enterprise tenants that are authorized to interact with the Q-Core gateway (e.g. `org-vardhan-intelligence`). Unknown tenants are inherently denied.
3. **Gateway Authority Evaluator**: Replaced the hard-coded `authorized: true` block with a formal `GatewayAuthorityEvaluator::evaluate()` call performing a 6-step independent policy and authority check before a transaction is authorized.
4. **Actor Identity Flow**: Updated `QCoreValidationRequest` to include an `actor_workload_id` field to carry explicit identity for evaluation against the policy's `authorized_actor_prefixes`.
5. **Fail-Closed Runtime**: Implemented rigorous negative paths where missing, unknown, mismatching, or unauthorized contexts produce an explicit `AuthDecision::Deny` yielding a `REJECTED_UNAUTHORIZED` result (or a more specific `DENY_*` code). This prevents a successful governed transaction or receipt from being generated on validation success alone.
6. **Immutable Decision Recording**: Authorized transactions now explicitly record their evaluated `gate_reference` and the deterministic reason string ("ALLOW") on the governed transaction via `tx.apply_authority_result()`.

## VERIFIED BY TEST
14 comprehensive unit tests were added directly covering:
* **T1**: Valid tenant + valid actor + valid policy + authorized action → ALLOW
* **T2**: Wrong tenant → DENY (`DENY_TENANT_UNKNOWN`)
* **T3**: Unknown tenant → DENY (`DENY_TENANT_UNKNOWN`)
* **T4**: Missing tenant → DENY (`DENY_TENANT_MISSING`)
* **T5**: Unauthorized action → DENY (`DENY_ACTION_NOT_GOVERNED`)
* **T6**: Unknown policy → DENY (`DENY_POLICY_UNKNOWN`)
* **T7**: Invalid policy version → DENY (`DENY_POLICY_VERSION_MISMATCH`)
* **T7b**: Latest policy version fallback attempt → DENY (`DENY_POLICY_VERSION_MISMATCH`)
* **T8**: Missing authority context / actor → DENY (`DENY_ACTOR_MISSING`)
* **T9**: Invalid actor/workload identity → DENY (`DENY_ACTOR_NOT_AUTHORIZED`)
* **T10**: Policy/action mismatch → DENY (`DENY_ACTION_NOT_GOVERNED`)
* **T11**: Attempt to bypass AuthorityGate with mismatched version → DENY
* **T13**: Deterministic behavior (same input yields same output)
* **T14**: Empty context is fully denied

## OBSERVED LIMITATION
* **Static Tenant Registry for Synchronous Gateway**: The gateway (`process_transaction`) is currently a synchronous function. The `TenantManager` in the `enterprise_tenant` crate relies on an async `RwLock<HashMap>`, making it difficult to directly invoke from the synchronous flow without blocking. A static `TenantRegistry` was employed within `policy_authority.rs` to mirror provisioned tenants. In a production environment, this should ideally be integrated asynchronously.
* **Ephemeral Cryptographic Keys**: While testing and inspecting the codebase, it was observed that signing keys (ML-DSA-87 and Ed25519) generated in `process_transaction` are ephemeral (recreated on every call). This means receipts cannot be verified by downstream systems. The signature verification function in `main.rs` currently skips verification explicitly (`VerifierConfig::verify(&receipt, None, None)`).

## NOT YET IMPLEMENTED
* **Dynamic Policy Registration**: Policies are currently defined statically within the `PolicyRegistry::build()` function. A dynamic policy registration and distribution mechanism (e.g., via a secure configuration endpoint or database) is not implemented.
* **Asynchronous Integration of TenantManager**: As noted above, the integration of `enterprise_tenant::TenantManager` into the Q-Core gateway flow for dynamic tenant resolution and rate limiting requires refactoring `process_transaction` and the Authority Evaluator to operate asynchronously.
