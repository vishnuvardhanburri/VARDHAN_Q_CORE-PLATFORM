# Vardhan Q-Core: Prospect Qualification Matrix & Account Record

**Document Reference:** `QCORE-SALES-QUAL-2026-10`  
**Commercial Lead Offer:** **Architecture & Security Discovery (£15,000 Fixed Fee)**  
**Target Milestone:** Move qualified institutional prospects into the **£65,000 Bounded PoV**.

---

## 1. The Repeatable Qualification Record

For every prospective banking institution, sales engineers and founders must complete this 6-point qualification record before scheduling a live demo or sharing the Technical PoV Security Dossier:

```text
+---------------------------------------------------------------------------------------------------+
| PROSPECT QUALIFICATION RECORD TEMPLATE                                                            |
+---------------------------------------------------------------------------------------------------+
| 1. Institution:                [Bank / Clearing Institution Name]                                 |
| 2. Existing Payment Arch:      [e.g., SWIFT FIN, ISO 20022 pacs.008, CHAPS RTGS, Fedwire]        |
| 3. Cryptographic Trigger:      [e.g., BoE RTGS Renewal, NIST FIPS 204 Mandate, DORA Audit]        |
| 4. Decision Owner:             [Name & Title: CISO, Head of Crypto Arch, Payments Director]       |
| 5. Current Migration Timeline: [e.g., 2026 Sandbox Evaluation, 2027 Production Migration Plan]    |
| 6. Discovery Fit Score (1-5):  [Fit evaluation for £15,000 fixed-fee 2-week engagement]          |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Institutional Qualification Matrix (Initial Hypotheses)

> [!IMPORTANT]
> **Research Governance Rule:**  
> The entries below represent **Initial Hypotheses — Validate During Account Research**. A public regulatory trigger or central bank roadmap does not automatically prove an active internal project, an allocated budget, or an engaged decision owner. Every account must be individually researched and verified against public initiatives and verified decision owners before outreach.

| Institution | Existing Payment Architecture | Public Cryptographic Trigger | Presumed Decision Owner | Presumed Migration Timeline | Initial Hypothesis Fit |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **Barclays UK** | Bank of England RTGS / CHAPS, Faster Payments (FPS), SWIFT ISO 20022 | PRA/FCA SS1/21 operational resilience; Bank of England PQC transition roadmap | Head of Cryptographic Architecture / Payments Resiliency Lead | Evaluating post-quantum dual-signing in sandboxes (2026) | Hypothesis: High (Validate) |
| **HSBC UK / Global** | Global Liquidity & Clearing, CHAPS, Fedwire, TARGET2 | Central bank mandates across UK & Eurozone; Store Now Decrypt Later risk | Group Head of Information Security / CISO Commercial Banking | Multi-year crypto-agility program active | Hypothesis: High (Validate) |
| **Lloyds Banking Group** | UK Domestic Clearing (BACS, Faster Payments, CHAPS) | PRA resilience stress-testing; legacy HSM modernization | Chief Security Architect / Payments Platform Director | Modernizing key management systems for ISO 20022 | Hypothesis: High (Validate) |
| **NatWest Group** | Faster Payments, RTGS clearing, API-based corporate banking | Operational resilience compliance; cloud-migration security gate | Head of Enterprise Security Architecture | Transitioning core settlement infrastructure | Hypothesis: High (Validate) |
| **JPMorgan Chase** | Fedwire, FedNow, Onyx / JPM Coin, SWIFT Network | NIST SP 800-208 / FIPS 204 guidance; OCC cyber risk requirements | Head of Quantum Cryptography & Security Engineering | Active quantum security research team evaluating PQC | Hypothesis: High (Validate) |
| **BNY Mellon** | Global custody, asset servicing, Fedwire clearing | Institutional custody asset security; regulatory due diligence | Global Head of Asset Servicing Technology / CISO | Assessing PQC impact on custody private keys | Hypothesis: High (Validate) |
| **Deutsche Bank** | European Central Bank TARGET2 / T2, EURO1, SWIFT | EU Digital Operational Resilience Act (DORA); ECB PQC roadmap | Head of Group Technology Security Architecture | DORA audit deadlines driving resilience validation | Hypothesis: High (Validate) |
| **SWIFT Network** | Interbank messaging (`pacs.008.001.08`, `pacs.009.001.08`) | ISO 20022 supplementary data dual-signing requirements | Head of Standards Architecture & Interbank Messaging | Adopting ISO 20022 messaging standards | Hypothesis: Medium (Validate) |

---

## 3. Account-Level 5-Point Validation Protocol (Focus: Initial 3–5 Accounts)

Do not run broad automated campaigns. Focus on 3 to 5 Tier-1 accounts. Before sending any outreach, complete these 5 validation checks:

```text
+---------------------------------------------------------------------------------------------------+
| 5-POINT ACCOUNT VALIDATION PROTOCOL                                                               |
+---------------------------------------------------------------------------------------------------+
| 1. Verified Trigger:        Public evidence of a payments, cryptographic, or resilience initiative|
|                             (e.g., conference talks, published papers, RFIs, hiring posts).       |
| 2. Architecture Relevance:  Identify ONE specific payment/message flow Q-Core could evaluate      |
|                             (e.g., pacs.008 customer credit transfer over CHAPS).                 |
| 3. Decision Path:           Identify the likely technical sponsor (Crypto Architect / Payments    |
|                             Lead) and economic buyer (CISO / Payments Platform Director).         |
| 4. Discovery Fit:           Confirm that the £15,000 fixed-fee 2-week engagement directly solves   |
|                             an immediate problem (threat impact audit & integration blueprint).   |
| 5. No-Go Check:             Strictly defer any account expecting live-rail connectivity or formal  |
|                             certification out of the gate.                                        |
+---------------------------------------------------------------------------------------------------+
```

---

## 4. Initial Focus Batch (Top 3 Target Accounts)

### Account 1: Barclays UK
1. **Verified Trigger:** Active participant in the Bank of England RTGS Renewal Program and PRA SS1/21 operational resilience audit cycle.
2. **Architecture Relevance:** CHAPS high-value customer credit transfer (`pacs.008.001.08`) with ML-DSA-87 dual-signing in supplementary data block.
3. **Decision Path:** Technical Sponsor: *Head of Cryptographic Architecture* | Economic Buyer: *Head of Core Payments Resiliency*.
4. **Discovery Fit:** £15,000 fixed fee delivers a 2-week risk & message-placement assessment without touching live rails.
5. **No-Go Gate:** Pass (No live rail expectations; sandbox scoping only).

### Account 2: HSBC UK
1. **Verified Trigger:** Publicly documented quantum security research group exploring quantum-safe key distribution and post-quantum cryptography on interbank liquidity rails.
2. **Architecture Relevance:** Wholesale liquidity and interbank transfer (`pacs.009.001.08`) dual-signing.
3. **Decision Path:** Technical Sponsor: *Lead Quantum Cryptography Architect* | Economic Buyer: *Group Head of Information Security / CISO Commercial Banking*.
4. **Discovery Fit:** £15,000 fixed fee scopes migration exposure across heterogeneous HSM infrastructure (AWS KMS / on-prem PKCS#11).
5. **No-Go Gate:** Pass (Research group understands simulation and sandbox boundaries).

### Account 3: Lloyds Banking Group
1. **Verified Trigger:** Migration of core payment engines to ISO 20022 and PRA resilience stress-testing.
2. **Architecture Relevance:** Domestic Faster Payments Service (FPS) transaction receipt integrity and audit ledger persistence.
3. **Decision Path:** Technical Sponsor: *Chief Security Architect* | Economic Buyer: *Payments Platform Technology Director*.
4. **Discovery Fit:** £15,000 fixed fee evaluates ledger hash-chaining and AWS KMS envelope custody against legacy key management constraints.
5. **No-Go Gate:** Pass (Agrees to bounded technical evaluation).

---

## 5. Qualification Gate: Discovery vs. Disqualification

To protect company resources, qualify or disqualify prospects based on these strict gates:

### Qualify for £15,000 Discovery If:
* [ ] The institution operates or participates in a real-time gross settlement system (CHAPS, Fedwire, TARGET2).
* [ ] The institution has an active internal roadmap, working group, or regulatory audit regarding Post-Quantum Cryptography (NIST / Bank of England / DORA).
* [ ] The prospect is willing to scope **one specific message flow** (e.g. `pacs.008` customer transfer) for the 2-week engagement.
* [ ] The decision owner has discretionary budget authority for bounded evaluation (£15,000).

### Disqualify / Defer If:
* [ ] The prospect demands immediate connection to live money rails (Remind them Q-Core is **Level 3 PRODUCTION BLOCKED**).
* [ ] The prospect expects production SLAs or FIPS certification out of a 2-week discovery.
* [ ] The prospect has no active payment rails or uses third-party payment aggregators without direct clearing access.

---

## 6. Next Step After Qualification

Once a qualification record is completed and verified:
1. Commercial workflow: **Account research → Qualification → First conversation → £15k Discovery → £65k controlled PoV**.
2. Dispatch **Template A** or **Template B** from [`TARGET_INSTITUTION_SHORTLIST_AND_OUTREACH.md`](TARGET_INSTITUTION_SHORTLIST_AND_OUTREACH.md).
3. Schedule a 20-minute exploratory conversation.
4. Conduct live meeting using [`docs/LIVE_DEMO_RUNBOOK.md`](../LIVE_DEMO_RUNBOOK.md).
5. Send formal Discovery agreement: [`docs/commercial/DISCOVERY_15K_SCOPE.md`](DISCOVERY_15K_SCOPE.md).
