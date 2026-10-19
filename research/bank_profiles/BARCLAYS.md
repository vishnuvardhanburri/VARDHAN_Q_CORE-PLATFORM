# Barclays — Bank Profile (Public Sources Only)

> Research note. No probing, no targeting of real bank infrastructure. All claims are conservative and limited to what live public sources establish. Profile names are research labels, not representations of internal systems.

## 1. Target + Classification
- **Target:** Barclays PLC (Barclays Corporate and Investment Bank / Barclays Execution Services).
- **Classification:** Bank (global universal / systemic investment bank; UK ring-fenced and non-ring-fenced entities).
- **Scope:** Live public sources below (established 2026-10-19). Target workflow: wholesale securities settlement batch optimization and trade submission non-repudiation.

## 2. Public-Source Items

### BAR-01 — Securities Settlement Batch Optimization with IBM Quantum
- **Title:** Barclays and IBM Quantum Settlement Optimization Research.
- **Publisher:** Barclays Chief Technology Office / IBM Quantum Network.
- **Date:** 2022–2024.
- **URL:** https://home.barclays/who-we-are/innovation/emerging-technologies/
- **Supported claim (one sentence):** Barclays Technology Office, under Dr. Lee Braine, published research evaluating quantum algorithms for optimizing the batch settlement of complex securities transactions.
- **Operational priority demonstrated:** Institutional focus on transaction settlement efficiency, counterparty settlement netting, and post-trade transaction integrity.
- **Proposed Q-Core workflow + why relevant:** Dual-signature (ML-DSA-87 + Ed25519) non-repudiation receipting over trade batch allocations and clearing submissions; relevant as a mathematical audit trail proving instruction lineage before market ingestion.
- **Likely stakeholder function:** CTO Office / Capital Markets Technology / Post-Trade Engineering.
- **Unresolved question:** Does Barclays require immutable counterparty non-repudiation at the point of batch netting or clearing handoff?
- **Confidence:** VERIFIED_PUBLIC_FACT (public joint publications with IBM and industry presentations by Dr. Lee Braine).

### BAR-02 — Global Cyber Operations Threat Management and PQC Resilience
- **Title:** Global Cyber Operations and Post-Quantum Defense Perspectives.
- **Publisher:** Barclays Global Cyber Operations / Industry Cybersecurity Forums.
- **Date:** 2023–2025.
- **URL:** https://home.barclays/sustainability/esg-resource-hub/reporting-and-disclosures/
- **Supported claim (one sentence):** Barclays Global Cyber Operations leadership publicly emphasizes defenses against automated multi-vector cyber threats and proactive preparation for post-quantum cryptographic migration.
- **Operational priority demonstrated:** Proactive defense against "Harvest Now, Decrypt Later" (HNDL) attacks targeting high-value corporate banking and wholesale payment channels.
- **Proposed Q-Core workflow + why relevant:** AER-KEP-Q high-assurance key encapsulation and post-quantum receipt verification for corporate banking API payloads.
- **Likely stakeholder function:** Group CISO / Head of Security Architecture / Cyber Operations.
- **Unresolved question:** What timeline has the Group CISO established for quantum-safe cryptographic agility across UK and global inter-entity transport?
- **Confidence:** VERIFIED_PUBLIC_FACT (public industry disclosures and conference proceedings).

### BAR-03 — Regulatory Compliance with UK PRA / FCA Operational Resilience (PS6/21)
- **Title:** Operational Resilience Disclosures and Important Business Services.
- **Publisher:** Barclays PLC Annual Report & Accounts.
- **Date:** 2024–2025.
- **URL:** https://home.barclays/investor-relations/reports-and-results/annual-reports/
- **Supported claim (one sentence):** Barclays discloses formal compliance frameworks for UK PRA/FCA PS6/21 operational resilience, mapping severe-but-plausible disruption scenarios across Important Business Services (IBS).
- **Operational priority demonstrated:** Regulatory mandate to prove business service continuity and data integrity without manual reconciliation failures during core banking disruptions.
- **Proposed Q-Core workflow + why relevant:** Deterministic disaster recovery (DR) state reconciliation and append-only tamper-evident audit logs that survive storage failover.
- **Likely stakeholder function:** Group Operational Resilience / Technology Risk Oversight.
- **Unresolved question:** How does Barclays independently verify transaction data integrity when switching between primary and secondary mainframe/cloud processing zones?
- **Confidence:** VERIFIED_PUBLIC_FACT (mandatory UK regulatory annual report disclosures).

## 3. NOT_SUPPORTED / CUSTOMER_VALIDATION_REQUIRED
- NOT_SUPPORTED: No breach, operational vulnerability, internal architecture defect, or regulatory enforcement is alleged or established.
- NOT_SUPPORTED: Barclays' internal budgets, vendor procurement shortlists, or production quantum deployment schedules are not established by public sources.
- CUSTOMER_VALIDATION_REQUIRED: Whether Barclays has an active commercial requirement or purchasing intent for Q-Core is unknown and requires direct buyer qualification.
- CUSTOMER_VALIDATION_REQUIRED: Any Q-Core integration is a hypothesis requiring buyer-provided testing scope and synthetic data in a non-production environment.

## 4. Honesty Footer
No vulnerabilities, incidents, control failures, architecture details, internal system names, or regulatory deficiencies are asserted. Public programmes do not establish deficiencies.
