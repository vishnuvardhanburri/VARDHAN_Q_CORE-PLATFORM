# Stage 2 — £60K Proof of Product (PoP)

**Offer status:** template to finalize only after the discovery gate passes.

## Commercial outcome

Demonstrate against a buyer-approved baseline whether one selected VARDHAN Q-CORE workflow delivers the required technical and business outcome in a controlled evaluation. Execute controlled technical validation, measure performance and security controls, and deliver technical evidence and evaluation results.

## Proposed duration and fee

- **Fee:** £60,000 GBP fixed fee. State VAT treatment, expenses, invoice milestones, and payment terms in the final SOW.
- **Duration:** 10 days (active controlled technical validation in authorized sandbox or customer VPC).
- **Start conditions:** accepted discovery, signed PoP SOW, named sponsor and technical owner, approved data handling, environment access, baseline, and signed acceptance criteria.

## Bounded evaluation scope

The default candidate is one end-to-end workflow:

1. Submit an agreed security/evidence finding or transaction.
2. Validate schema, tenant context, workload/service identity, and policy boundary.
3. Produce the agreed cryptographically verifiable receipt for successful cases.
4. Independently verify the receipt using agreed public-key/trust configuration.
5. Reject in-scope tampered payloads/signatures, duplicate/replayed requests, unauthorized identities, and tenant/path substitution attempts.
6. Record verification outcome and export the agreed audit/evidence record.
7. Measure latency, throughput, failures, operational effort, and integration effort under a jointly agreed workload.

Freeze the path, number of integrations, environment, fixtures, and test volume in the SOW. Avoid silent scope expansion.

## Measurement plan

At kickoff, define a baseline and target for each applicable dimension:

- **Correctness:** accepted valid cases / total valid cases.
- **Adversarial rejection:** rejected in-scope tamper, replay, unauthorized-identity, and cross-tenant cases / total agreed adversarial cases.
- **Independent verification:** accepted receipts that pass verification by the agreed independent verifier.
- **Audit completeness:** transactions with all required correlated receipt, transaction, verification, and audit fields.
- **Performance:** p50/p95 latency, throughput, resource use, and error rate at agreed environment and load.
- **Integration:** effort, unresolved dependencies, operational steps, and changes needed to connect the nominated system.
- **Business value:** one or more buyer-owned measures, such as reduced manual evidence-reconciliation time or improved review traceability. Establish baseline and target with the buyer; do not claim value before measurement.

Success thresholds are not pre-asserted here. Put them in the signed acceptance table before execution.

## Deliverables

- Versioned PoV plan and test/acceptance matrix.
- Agreed workflow integrated in the bounded, authorized environment.
- Reproducible evidence and results for every acceptance criterion.
- Performance and business-baseline comparison with assumptions disclosed.
- Security findings and remediation plan, with critical unresolved findings explicit.
- Operational walkthrough covering configuration, trust material, telemetry, recovery, and failure handling in scope.
- Final result: **Pass / Fail / Inconclusive**, traceable to individual criteria.
- Production decision pack: target architecture, scope/BOM, support model, risks, and commercial assumptions.

## Acceptance criteria

The SOW must list baseline, target/threshold, method, owner, evidence artifact, pass/fail rule, and tolerated exceptions for every criterion. The PoV may pass only when the agreed test matrix is executed, results are reproducible, deviations/security findings are disclosed, business outcomes are compared to baseline, the named buyer approver accepts results under the signed procedure, and the production decision pack is delivered.

If a test is blocked by unavailable buyer access or dependencies, mark it blocked/inconclusive—not passed.

## Buyer responsibilities

Provide authorized access, approved test data or synthetic-data approval, integration owners, security contacts, test environment, baseline information, timely decisions, and a named acceptance authority.

## Out of scope

- General availability or production cutover.
- Enterprise-wide rollout, integrations, or deployments beyond the agreed boundary.
- Unspecified production SLA or uptime/performance guarantees.
- Independent penetration test, red-team, certification, or third-party audit unless explicitly contracted.
- Custom features beyond the frozen backlog.
- Any commitment that an annual production contract will be awarded.

## Gate to production engagement

Proceed only after the buyer accepts the PoV and confirms material value; production-blocking security issues have owners and remediation/assurance plans; production architecture, deployment, identity, keys, transport, monitoring, backup/restore, incident handling, and audit-export requirements are agreed; security/procurement/legal/finance/operations stakeholders confirm their route; and both sides agree the production scope, milestones, acceptance, commercial basis/term (referencing [`docs/COMMERCIAL_PRICING_MODEL.md`](../COMMERCIAL_PRICING_MODEL.md)), support/SLA, and contract terms.

A failed or inconclusive PoV does not justify a production claim.
