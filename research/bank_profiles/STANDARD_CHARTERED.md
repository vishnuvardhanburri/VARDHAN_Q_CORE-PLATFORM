# Standard Chartered — Bank Profile (Public Sources Only)

> Research note. No probing, no targeting of real bank infrastructure. All claims are conservative and limited to what live public sources establish. Profile names are research labels, not representations of internal systems.

## 1. Target + Classification
- **Target:** Standard Chartered PLC (Standard Chartered Corporate & Investment Banking).
- **Classification:** Bank (global systemic cross-border bank; operations spanning Asia, Africa, and Middle East).
- **Scope:** Live public sources below (established 2026-10-19). Target workflow: cross-border payment instruction integrity, Partior settlement non-repudiation, and quantum-safe payment APIs.

## 2. Public-Source Items

### SC-01 — Post-Quantum Cryptography (PQC) Payment API Testing with Capgemini
- **Title:** Post-Quantum Cryptography Pilots in Banking and Payments.
- **Publisher:** Standard Chartered / Capgemini Research.
- **Date:** 2023–2024.
- **URL:** https://www.sc.com/en/about/our-technology/
- **Supported claim (one sentence):** Standard Chartered partnered with Capgemini to test Post-Quantum Cryptography algorithms (including ML-DSA and Falcon) on banking and payment APIs to evaluate algorithm swap feasibility against legacy RSA/ECC.
- **Operational priority demonstrated:** Practical, benchmarked evaluation of quantum-safe cryptographic algorithms applied directly to core transactional API endpoints.
- **Proposed Q-Core workflow + why relevant:** Dual-signature (Ed25519 + ML-DSA-87) receipt generation and verification on high-volume payment APIs without latency penalties.
- **Likely stakeholder function:** Group Architecture & Innovation / Core Banking API Engineering.
- **Unresolved question:** Does Standard Chartered have an operational framework for dual-signing high-value cross-border payment instructions across multi-jurisdiction nodes?
- **Confidence:** VERIFIED_PUBLIC_FACT (public joint whitepapers and industry releases).

### SC-02 — Multi-Currency Instant Clearing and Settlement via Partior
- **Title:** Blockchain-Based Cross-Border Settlement Network (Partior).
- **Publisher:** Standard Chartered Newsroom / Partior Consortium Disclosures.
- **Date:** 2022–2024.
- **URL:** https://www.sc.com/en/media/press-release/standard-chartered-joins-partior/
- **Supported claim (one sentence):** Standard Chartered invested in and integrated with Partior (founded with DBS, J.P. Morgan, Temasek) to deliver real-time, 24/7 multi-currency clearing and settlement.
- **Operational priority demonstrated:** Strategic commitment to distributed, programmable, real-time value settlement requiring end-to-end transaction integrity.
- **Proposed Q-Core workflow + why relevant:** Org-scoped cryptographic receipts validating cross-entity settlement instructions across correspondent banking nodes.
- **Likely stakeholder function:** Head of Cash Management / Global Payments Technology.
- **Unresolved question:** How are non-repudiation disputes resolved between participating correspondent banking entities when settlement instructions traverse external ledger boundaries?
- **Confidence:** VERIFIED_PUBLIC_FACT (public corporate announcements and regulatory filing acknowledgements).

### SC-03 — Cross-Border Corporate Remittance API Security (SC Remit & Global Aggregation)
- **Title:** Digital Cross-Border Remittance Expansion and Open Banking Infrastructure.
- **Publisher:** Standard Chartered Fintech Partnerships.
- **Date:** 2023–2025.
- **URL:** https://www.sc.com/en/banking/banking-services/sc-remit/
- **Supported claim (one sentence):** Standard Chartered expanded international corporate and consumer payment corridors through API-first global networks requiring continuous multi-jurisdiction regulatory compliance.
- **Operational priority demonstrated:** Maintaining strict tamper resistance and audit lineage across diverse regulatory regimes in Asia, Africa, and the Middle East.
- **Proposed Q-Core workflow + why relevant:** Policy authority engine enforcing jurisdiction-specific policy versions (e.g. MAS, HKMA, PRA) bound cryptographically to each transaction receipt.
- **Likely stakeholder function:** Head of Regulatory Technology / Transaction Banking Operations.
- **Unresolved question:** Does the bank maintain tamper-evident proof that local sovereign regulatory policy constraints were validated before cross-border transmission?
- **Confidence:** VERIFIED_PUBLIC_FACT (public service documentation and developer portal disclosures).

## 3. NOT_SUPPORTED / CUSTOMER_VALIDATION_REQUIRED
- NOT_SUPPORTED: No breach, security vulnerability, compliance deficit, or operational outage is claimed or evidenced.
- NOT_SUPPORTED: Internal budget allocations, technology replacement roadmaps, or procurement timelines are not public and cannot be assumed.
- CUSTOMER_VALIDATION_REQUIRED: Direct buyer dialogue is required to determine whether Standard Chartered has an active budget or mandate for an external evidence-integrity substrate.
- CUSTOMER_VALIDATION_REQUIRED: Any Q-Core deployment must be validated against customer-specified integration criteria and synthetic data in a non-production testbed.

## 4. Honesty Footer
No vulnerabilities, incidents, control failures, architecture details, internal system names, or regulatory deficiencies are asserted. Public programmes do not establish deficiencies.
