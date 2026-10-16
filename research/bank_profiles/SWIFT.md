# Swift — Financial-Messaging Infrastructure Profile (Public Sources Only)

> Research note. No probing, no targeting of real messaging infrastructure. Swift is classified separately from banks. All claims are conservative and limited to what live public sources establish. Profile names are research labels, not representations of internal systems.

## 1. Target + classification
- **Target:** Swift (Society for Worldwide Interbank Financial Telecommunication, S.W.I.F.T. SC).
- **Classification:** Financial-messaging infrastructure (cooperative; NOT a bank).
- **Scope:** Live-fetched public sources below (fetched 2026-10-17).

## 2. Public-source items

### SWF-01 — Cooperative messaging network identity (live-verified)
- **Title:** Society for Worldwide Interbank Financial Telecommunication (encyclopaedic profile).
- **Publisher:** Wikipedia (tertiary; references Swift disclosures).
- **Date:** 2024 (figures cited: ~11,000 institutions, 200+ countries; 2015/2018 anchors).
- **URL:** https://en.wikipedia.org/wiki/Society_for_Worldwide_Interbank_Financial_Telecommunication
- **Supported claim (one sentence):** Swift is a Belgian cooperative founded 1973 providing the main cross-border payments messaging network plus BIC assignment and Sibos.
- **Operational priority demonstrated:** Systemic role in cross-border payment initiation.
- **Proposed Q-Core workflow + why relevant:** Messaging-integrity analogy (per-org sealed receipts over payment-adjacent instructions); relevant only as a lab pattern, synthetic data only.
- **Likely stakeholder function:** Payments operations / standards (customer-side, to be confirmed).
- **Unresolved question:** Which message-integrity evidence, if any, would the customer want lab-demonstrated?
- **Confidence:** VERIFIED_PUBLIC_FACT (tertiary profile of long-stable facts).

### SWF-02 — Customer Security Programme after 2016 fraud cases (live-verified)
- **Title:** SWIFT's Customer Security Program: Lessons for the Cybersecurity Community (ISACA Journal, synthesising Swift disclosures).
- **Publisher:** ISACA (secondary synthesis; primary = Swift CSP publications).
- **Date:** 2022 (journal volume 1, 2022; programme inception 2016-2017).
- **URL:** https://www.isaca.org/resources/isaca-journal/issues/2022/volume-1/swifts-customer-security-program-lessons-for-the-cybersecurity-community
- **Supported claim (one sentence):** Following 2016 fraud cases, Swift introduced the Customer Security Programme with a mandatory-controls framework (CSCF: 16 mandatory + 11 advisory at v1) and an attestation regime.
- **Operational priority demonstrated:** Community-wide endpoint-security uplift via mandatory, attestable controls.
- **Proposed Q-Core workflow + why relevant:** Control-attestation evidence demo (mTLS-bound transport + independently verified receipts per org); relevant as a lab analogy for attestable control evidence.
- **Likely stakeholder function:** Customer-security / compliance attestation (to be confirmed).
- **Unresolved question:** Which attestation artefacts, if any, does the customer produce from lab tooling?
- **Confidence:** VERIFIED_PUBLIC_FACT (programme inception + v1 control counts per secondary synthesis of Swift disclosures).

### SWF-03 — CSP ten-year retrospective (live-verified)
- **Title:** Ten Years On: How the SWIFT Customer Security Programme Reshaped Global Financial Cybersecurity.
- **Publisher:** World Informatix (secondary retrospective).
- **Date:** 2026-05 (retrospective marking a decade since the 2016 trigger).
- **URL:** https://worldinformatixcs.com/2026/05/27/ten-years-on-swift-csp-cybersecurity/
- **Supported claim (one sentence):** A 2026 retrospective traces a decade of mandatory CSP controls reshaping financial-sector endpoint security after the Bangladesh Bank heist trigger.
- **Operational priority demonstrated:** Sustained, evolving control regime with rising attestation submission rates.
- **Proposed Q-Core workflow + why relevant:** Longitudinal control-evidence narrative (versioned policy + re-verifiable historical receipts); relevant as a lab demo of evidence that survives control-version changes.
- **Likely stakeholder function:** Security governance / audit (to be confirmed).
- **Unresolved question:** Does the customer require historical control evidence to remain verifiable across versions?
- **Confidence:** Secondary retrospective; trigger event + programme existence VERIFIED_PUBLIC_FACT.

### SWF-04 — Bangladesh Bank incident as programme trigger (live-verified)
- **Title:** Bangladesh Bank robbery (encyclopaedic incident profile).
- **Publisher:** Wikipedia (tertiary; widely sourced).
- **Date:** 2016-02 (incident month).
- **URL:** https://en.wikipedia.org/wiki/Bangladesh_Bank_robbery
- **Supported claim (one sentence):** In Feb 2016 attackers issued ~35 fraudulent Swift instructions moving funds from Bangladesh Bank's New York account, the event that triggered the CSP.
- **Operational priority demonstrated:** Endpoint compromise of trusted messaging as a systemic risk (INDUSTRY_RISK context, not a Swift deficiency claim).
- **Proposed Q-Core workflow + why relevant:** Fraudulent-instruction analogy for replay/tamper/unauthorised-actor tests (duplicate, tampered, cross-tenant submissions must fail closed); relevant as lab threat-model motivation.
- **Likely stakeholder function:** Fraud / payments-security functions (to be confirmed).
- **Unresolved question:** Which fraudulent-instruction patterns does the customer test in its own labs?
- **Confidence:** VERIFIED_PUBLIC_FACT (incident occurrence; NO deficiency asserted against Swift).

## 3. NOT_SUPPORTED / CUSTOMER_VALIDATION_REQUIRED
- NOT_SUPPORTED: No Swift control failure, architecture detail, internal system name, product version, or regulatory deficiency is established by the above.
- NOT_SUPPORTED: The 2016 incident establishes attacker abuse of a customer endpoint, not a Swift network deficiency; Swift is the programme owner, not the deficient party.
- CUSTOMER_VALIDATION_REQUIRED: Whether any Swift-connected institution has interest, need, or procurement path for Q-Core is unknown.
- CUSTOMER_VALIDATION_REQUIRED: Any Q-Core workflow above is a PRODUCT_HYPOTHESIS requiring explicit customer request and synthetic/lab data only.
- Q-Core does not replace Swift CSP/CSCF, enterprise audit systems, or independent assessors; at most a complementary discovery aid.

## 4. Honesty footer
No vulnerabilities, incidents, control failures, architecture details, internal system names, or regulatory deficiencies are asserted (the 2016 incident is historical public fact cited as programme context, not as a Swift deficiency). Public programmes do not establish deficiencies.
