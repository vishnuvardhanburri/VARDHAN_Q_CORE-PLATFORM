# Stage 1 — £15K Architecture & Security Discovery

**Offer status:** proposal template; scope and commercial terms require buyer agreement.

## Commercial outcome

Establish whether the buyer has a material problem VARDHAN Q-CORE should solve, whether a limited technical evaluation is feasible, and what evidence would justify or reject a production investment. The discovery produces a decision-ready recommendation; it does not certify the platform or deliver a production deployment.

## Proposed duration and fee

- **Fee:** £15,000 GBP fixed fee. Explicitly state VAT treatment, expenses, invoice schedule, and payment terms in the final proposal.
- **Duration:** 48 hours (rapid, decision-oriented discovery; not a prolonged multi-week implementation).
- **Start condition:** signed agreement, named sponsor, confirmed scope, and agreed access/data-handling rules.

## Scope

1. **Business problem and decision context:** sponsor and technical-owner workshops; workflow, consequence of failure, current controls/workarounds, and why the issue matters now. Separate buyer-confirmed facts from hypotheses and public observations.
2. **Current-state and trust-boundary map:** map the agreed discovery/evidence → validation/policy → receipt → independent verification path; identify systems, actors, tenant boundaries, evidence sources, and downstream consumers.
3. **Technical feasibility:** review architecture and integration points; perform a bounded, non-production feasibility exercise using synthetic data or customer-authorized samples; report failures and limitations.
4. **Security and operations gaps:** assess relevant identity/authentication, tenant isolation, signing-key lifecycle, transport, replay protection, audit evidence, deployment, recovery, monitoring, and support requirements. Produce a prioritized gap register; do not portray self-authored tests as independent security assurance.
5. **PoV design and decision:** choose one workflow; define inputs, outputs, test data, environment, access, workload, baseline, responsibilities, measurable criteria, and pass/fail/inconclusive rules. Recommend proceed, remediate first, or stop.

## Deliverables

- Sponsor-approved problem statement and use-case boundary.
- Current-state/reference architecture and trust-boundary diagram.
- Feasibility findings with reproducible evidence for in-scope checks.
- Prioritized technical/security/operational gap register.
- Data/access/integration dependency list and responsibility matrix.
- PoV plan with baseline, measurable acceptance criteria, test cases, exclusions, decision owners, and proposed schedule.
- Final decision workshop and written recommendation: **Proceed / Proceed after prerequisites / Stop**.

## Acceptance criteria

Discovery is complete when the agreed workshops and bounded feasibility activities have been performed, or blocked dependencies are documented; every listed deliverable is supplied; findings distinguish verified facts, test results, assumptions, and unknowns; the proposed PoV identifies sponsor, technical owner, authorized access/data, workable environment, and mutually agreed metrics; and the final decision workshop has been held.

The signed contract must specify the review period, correction process, and deemed-acceptance rules.

## Buyer responsibilities

Provide sponsor, technical/security representatives, current process and architecture context, stakeholder access, and written authorization for any data or environment used. Confirm data restrictions. Buyer-controlled access delays may change the schedule.

## Out of scope

- Production deployment, production cutover, or production SLA.
- Broad multi-team/system implementation.
- Penetration test, red-team, independent cryptographic review, certification, or audit attestation.
- Custom integrations not listed in the signed scope.
- Sensitive live data unless separately assessed, authorized, and explicitly agreed.
- The £60K PoP (Proof of Product), ongoing support, or any commitment to buy production.

## Gate to £60K PoP (Proof of Product)

Proceed only if both parties confirm in writing that the problem is worthwhile; the sponsor accepts the desired outcome; feasibility and access/data/environment owners are identified; baseline and measurable success thresholds are agreed before testing; security/procurement/legal/commercial routes are understood; and the PoP SOW, price, exclusions, responsibilities, and acceptance procedure are signed.

A stop recommendation is a valid outcome; there is no obligation to buy the PoP.
