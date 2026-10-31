# Vardhan Q-Core — Commercial Pricing Model & Engagement Governance

Vardhan Q-Core uses a **structured enterprise engagement and licensing model**, progressing from technical problem validation and proof of value to annual production licences and individually scoped sovereign enclave deployments.

---

## 1. Authoritative Commercial Catalogue

All pricing is in GBP.

### A. Commercial Entry Stages (Fixed-Fee Bounded Engagements)
- **Discovery (`qcore_architecture_evaluation`): £15,000 fixed fee**  
  Fixed-scope architecture and cryptographic readiness evaluation. Assesses one specific customer workflow for submission integrity, policy enforcement, replay protection, or independently verifiable trust receipts. Delivery target: 48 hours after prerequisites, access, and agreement are established.
- **Proof of Value (`qcore_proof_of_value`): £65,000 fixed fee**  
  Time-boxed 10-day evaluation run in a bounded, authorized environment evaluating dual-signature verification against agreed criteria. Deliverable: recorded test evidence, measured criteria results, and formal go/no-go recommendation.

### B. Annual Q-Core Licences (Annual Recurring Subscriptions)
- **Foundation (`foundation`): £360,000 / year**  
  Production single-tenant receipt signing and local verification (`q_core`, `audit`, `api`).
- **Enterprise (`enterprise`): £720,000 / year**  
  Multi-user global financial enterprise control plane with SCIM provisioning, WebAuthn MFA, role-based IAM, enterprise SIEM integrations, and consumption telemetry (`q_core`, `audit`, `api`, `rbac`, `integrations`, `compliance`, `usage`).
- **Advanced Resilience (`advanced_resilience`): £1,200,000 / year**  
  Dedicated cryptographic resilience tier including key epoch transitions (`aer_kep_q`), high-availability clustered nodes (`ha`), deterministic disaster recovery (`dr`), and hardware vault protection hooks (`hsm_kms`).

### C. Strategic / Sovereign Enclave (Individually Scoped Engagement)
- **Strategic / Sovereign (`strategic`): Individually scoped (£5,000,000–£50,000,000, £12,000,000 baseline target)**  
  Air-gapped and sovereign enclave deployments for defense, intelligence, and central banking institutions (`sovereign_deployment`, `air_gapped`, `dedicated_assurance`).

---

## 2. Commercial Progression & Pricing Structure

> [!IMPORTANT]
> **Commercial Progression:** The enterprise software pricing progression strictly follows architectural capability and governance complexity:
> 
> - **Foundation (£360,000 / year):** Entry production tier providing core submission verification, dual receipts, and local audit logging.
> - **Enterprise (£720,000 / year):** Organization-wide governance, SCIM 2.0 user lifecycle management, role-based IAM, and regulatory SIEM telemetry.
> - **Advanced Resilience (£1,200,000 / year):** Mission-critical tier adding post-quantum key epoch transitions (AER-KEP-Q), active-active HA clustering, disaster recovery automation, and HSM/KMS custody hooks.
> - **Strategic / Sovereign (Bespoke / £12,000,000 target):** Dedicated air-gapped sovereign deployment with custom enclave engineering and dedicated cryptographic assurance.

---

## 3. Explicit Billing Models & Cadence

The catalogue enforces three distinct billing classifications. Entries are not equivalent subscription plans:

1. **Fixed Fee (`fixed_fee` / `one_off`):** One-time bounded professional service engagements (Discovery £15K, PoV £65K). Not recurring.
2. **Annual Licence (`annual_license` / `annual`):** Annual recurring software licences (Foundation £360K/yr, Enterprise £720K/yr, Advanced Resilience £1.2M/yr).
3. **Scoped Engagement (`scoped` / `custom`):** Individually scoped contract terms (Strategic bespoke / £12M target).

*Historical Note:* Earlier preliminary briefs referenced a "£500,000 target production engagement". That figure served as a historical planning placeholder. The authoritative structure is now established in the backend catalogue above.

---

## 4. Product Boundaries: Q-Core vs. Vardhan Intelligence

Vardhan Q-Core and Vardhan Intelligence are independently purchasable, strictly decoupled products:

1. **Vardhan Q-Core (`product: "q_core"`):**
   - Cryptographic substrate, dual-signature receipt engine (ML-DSA-87 + Ed25519), append-only audit ledger, and policy enforcement kernel.
   - Authoritative pricing catalogue is governed exclusively by `backend/control_plane_api/src/lib.rs`.

2. **Vardhan Intelligence Engine:**
   - Autonomous external discovery, surface mapping, entity resolution, and opportunity qualification plane.
   - Operates on public surface evidence; does not execute privileged actions on Q-Core without authorized cryptographic credentials.

---

## 5. Rules for Vardhan Intelligence Engine

The intelligence plane and autonomous opportunity discovery agents must adhere to the following operational rules:

1. **Workflow & Capability Mapping**:
   - Map every qualified opportunity to a specific customer workflow and a demonstrated Q-Core capability.
   - Do not claim unsupported or planned capabilities for production stages.

2. **Stage Progression Gates**:
   - **Recommend Discovery (£15K)**: When the customer problem is plausible but scope, technical requirements, or value proposition need validation.
   - **Recommend PoV (£60K)**: Only when a defined problem, technical feasibility, customer access, and measurable acceptance criteria can be established.
   - **Recommend Production Licence**: Only after the PoV demonstrates material value and deployment, assurance, operational, and commercial requirements are addressed.

3. **Inference & Research Boundary**:
   - Do not infer buying intent, budget approval, or willingness to pay from public research.
   - Public facts establish technical context, not internal commercial commitments.

4. **Outreach & Pricing Discipline**:
   - **Keep prices out of initial cold outreach** unless explicitly authorized by the operator.
   - Cold outreach must focus strictly on the customer's dated technical problem, verifiable public facts, and specific workflow hypotheses.

5. **Contractual Status**:
   - Treat all pricing entries as proposed commercial offers until formally executed with the customer.
   - Pipeline is not cash; revenue is only recognized upon contract execution and payment clearance.
   - Prices do not guarantee customer acceptance, market demand, SLA, or third-party certification.

---

## 6. Related References & Documents

- Authoritative Plan Catalog: `GET /api/v1/catalog/plans`
- Billing Architecture: [`docs/mission-j/BILLING_AND_ENTITLEMENTS.md`](file:///Users/vishnuvardhanburri/antigravity/VARDHAN_Q_CORE-PLATFORM-main/docs/mission-j/BILLING_AND_ENTITLEMENTS.md)
- Discovery Scope & Deliverables: [`docs/commercial/DISCOVERY_15K_SCOPE.md`](file:///Users/vishnuvardhanburri/antigravity/VARDHAN_Q_CORE-PLATFORM-main/docs/commercial/DISCOVERY_15K_SCOPE.md)
- Proof of Value Scope & Acceptance: [`docs/commercial/POV_65K_SCOPE.md`](file:///Users/vishnuvardhanburri/antigravity/VARDHAN_Q_CORE-PLATFORM-main/docs/commercial/POV_65K_SCOPE.md)
- Production Engagement Planning: [`docs/commercial/PRODUCTION_500K_SCOPE.md`](file:///Users/vishnuvardhanburri/antigravity/VARDHAN_Q_CORE-PLATFORM-main/docs/commercial/PRODUCTION_500K_SCOPE.md)
- Commercial Path Overview: [`docs/commercial/README.md`](file:///Users/vishnuvardhanburri/antigravity/VARDHAN_Q_CORE-PLATFORM-main/docs/commercial/README.md)
