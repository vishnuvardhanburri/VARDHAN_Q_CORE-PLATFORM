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

## 2. Institutional Qualification Matrix (Pre-Populated Records)

| Institution | Existing Payment Architecture | Cryptographic Trigger | Primary Decision Owner | Current Migration Timeline | Discovery Fit (£15K) |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **Barclays UK** | Bank of England RTGS / CHAPS, Faster Payments (FPS), SWIFT ISO 20022 | PRA/FCA SS1/21 operational resilience; Bank of England PQC transition roadmap | Head of Cryptographic Architecture / Payments Resiliency Lead | Evaluating post-quantum dual-signing in sandboxes (2026) | **HIGH (5/5)** |
| **HSBC UK / Global** | Global Liquidity & Clearing, CHAPS, Fedwire, TARGET2 | Central bank mandates across UK & Eurozone; Store Now Decrypt Later risk | Group Head of Information Security / CISO Commercial Banking | Multi-year crypto-agility program active | **HIGH (5/5)** |
| **Lloyds Banking Group** | UK Domestic Clearing (BACS, Faster Payments, CHAPS) | PRA resilience stress-testing; legacy HSM modernization | Chief Security Architect / Payments Platform Director | Modernizing key management systems for ISO 20022 | **HIGH (5/5)** |
| **NatWest Group** | Faster Payments, RTGS clearing, API-based corporate banking | Operational resilience compliance; cloud-migration security gate | Head of Enterprise Security Architecture | Transitioning core settlement infrastructure | **HIGH (5/5)** |
| **JPMorgan Chase** | Fedwire, FedNow, Onyx / JPM Coin, SWIFT Network | NIST SP 800-208 / FIPS 204 guidance; OCC cyber risk requirements | Head of Quantum Cryptography & Security Engineering | Active quantum security research team evaluating PQC | **HIGH (5/5)** |
| **BNY Mellon** | Global custody, asset servicing, Fedwire clearing | Institutional custody asset security; regulatory due diligence | Global Head of Asset Servicing Technology / CISO | Assessing PQC impact on custody private keys | **HIGH (5/5)** |
| **Deutsche Bank** | European Central Bank TARGET2 / T2, EURO1, SWIFT | EU Digital Operational Resilience Act (DORA); ECB PQC roadmap | Head of Group Technology Security Architecture | DORA audit deadlines driving resilience validation | **HIGH (5/5)** |
| **SWIFT Participants** | Interbank messaging (`pacs.008.001.08`, `pacs.009.001.08`) | ISO 20022 supplementary data dual-signing requirements | Head of Standards Architecture & Interbank Messaging | Adopting ISO 20022 messaging standards | **MEDIUM (4/5)** |

---

## 3. Qualification Gate: Discovery vs. Disqualification

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

## 4. Next Step After Qualification

Once a qualification record is completed and verified:
1. Dispatch **Template A** or **Template B** from [`TARGET_INSTITUTION_SHORTLIST_AND_OUTREACH.md`](TARGET_INSTITUTION_SHORTLIST_AND_OUTREACH.md).
2. Schedule a 20-minute exploratory conversation.
3. Conduct live meeting using [`docs/LIVE_DEMO_RUNBOOK.md`](../LIVE_DEMO_RUNBOOK.md).
4. Send formal Discovery agreement: [`docs/commercial/DISCOVERY_15K_SCOPE.md`](DISCOVERY_15K_SCOPE.md).
