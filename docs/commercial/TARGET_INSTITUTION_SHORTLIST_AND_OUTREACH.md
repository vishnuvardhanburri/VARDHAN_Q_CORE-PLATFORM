# Vardhan Q-Core: Target Institution Shortlist & Outreach Playbook

**Document Reference:** `QCORE-SALES-OUTREACH-2026-10`  
**Commercial Lead Offer:** **Architecture & Security Discovery (£15,000 Fixed Fee)**  
**Target Roles:** Chief Information Security Officers (CISOs), Heads of Cryptographic Architecture, Payments Infrastructure Directors, and Enterprise Risk Officers.

---

## 1. Outreach Strategy: Lead with Discovery, Not Production Licensing

> [!IMPORTANT]
> **The Golden Rule of Enterprise Cryptographic Sales:**  
> Never attempt to sell a £360K+ production license or a £65K PoV on an initial cold call or email. Banks have strict procurement and risk processes.  
> **Always lead with the £15,000 fixed-fee Architecture & Security Discovery.** It is a low-risk, bounded engagement that creates the contractual and technical foundation for the £65,000 PoV and subsequent core licensing.

---

## 2. Target Institution Shortlist & Triggers

| Priority Tier | Target Institutions | Key Operational Trigger | Lead Angle |
| :---: | :--- | :--- | :--- |
| **Tier 1 (UK Anchor)** | **Barclays, HSBC UK, Lloyds Banking Group, NatWest Group** | Bank of England RTGS Renewal, CHAPS settlement modernization, and PRA/FCA SS1/21 & PS21/3 Operational Resilience. | "How are you preparing CHAPS high-value settlement pipelines for post-quantum dual signing without breaking ISO 20022 XML parsing?" |
| **Tier 1 (US Financials)** | **JPMorgan Chase, BNY Mellon, Citi, State Street** | Federal Reserve Fedwire Funds Service, FedNow Service, and NIST FIPS 203/204 migration timelines. | "Assessing Fedwire ISO 20022 customer credit transfers against quantum 'Store Now, Decrypt Later' capture risks." |
| **Tier 1 (Eurozone / Int'l)** | **Deutsche Bank, BNP Paribas, Santander, UBS** | European Central Bank (ECB) TARGET2 / T2 consolidation, and EU Digital Operational Resilience Act (DORA). | "DORA operational resilience compliance: proving cryptographic agility and hardware key custody without vendor lock-in." |
| **Tier 2 (Market Infrastructure)** | **SWIFT Network Participants, The Clearing House (CHIPS/RTP), Euroclear** | High-throughput interbank clearing message protection and multi-tenant ledger integrity. | "Multi-process advisory locking and 1,500+ req/sec post-quantum receipt sealing for interbank netting." |

---

## 3. Executive Outreach Templates

### Template A: Cold Outreach to Head of Cryptographic Architecture / Payments Infrastructure Lead

**Subject:** PQC dual-signing on ISO 20022 payment rails (NIST FIPS 204)

> Hi [First Name],
>
> With the Bank of England and global central banks actively establishing timelines for post-quantum cryptography, high-value clearing rails (CHAPS / Fedwire) face an immediate architectural challenge: transitioning to quantum-safe signatures without disrupting downstream ISO 20022 message parsers.
>
> At Vardhan Technologies, we have engineered **Q-Core**, a post-quantum cryptographic substrate that combines NIST FIPS 204 (ML-DSA-87) with classical Ed25519 dual-signing, exact integer minor-unit accounting, and hardware KMS key custody.
>
> We do not sell unvetted production software onto live rails. Instead, we offer an initial **Architecture & Security Discovery (£15,000 fixed fee, 2 weeks)** where we:
> 1. Audit your current ISO 20022 (`pacs.008`/`pacs.009`) messaging pipelines for quantum-vulnerable touchpoints.
> 2. Model dual-signature envelope placement without breaking legacy parsers.
> 3. Deliver a formal Quantum Threat Impact Assessment and PoV test specification for your risk committee.
>
> Would you or your cryptographic engineering lead have 15 minutes next Tuesday to review our reproducible test evidence?
>
> Best regards,  
> [Your Name]  
> Vardhan Technologies — Q-Core  
> https://github.com/vishnuvardhanburri/VARDHAN_Q_CORE-PLATFORM

---

### Template B: LinkedIn InMail to CISO / Head of Security Architecture

**Subject:** Quantum-safe operational resilience for RTGS / CHAPS rails

> Hi [First Name],
>
> As PRA/FCA SS1/21 resilience deadlines advance alongside NIST’s finalized post-quantum standards, banks are addressing 'Store Now, Decrypt Later' exposure on high-value interbank clearing.
>
> We recently published our **Technical PoV Security Dossier** demonstrating:
> • ML-DSA-87 + Ed25519 dual-signing on financial transaction payloads.
> • Live cloud hardware HSM envelope custody (AWS KMS) with zero plaintext key persistence across cold restarts.
> • Isolated 3-tier PQC X.509 PKI chain validation and certificate rotation.
>
> We work with institutional teams through a bounded **£15,000 Architecture Discovery** to assess specific payment flows before any sandbox PoV is discussed.
>
> Happy to send over our one-page technical brief if this is on your 2026/2027 cryptographic roadmap.
>
> Best,  
> [Your Name]

---

## 4. Objection Handling Guide (Deliberate Boundaries as Strengths)

| Prospect Question / Objection | Safe, Authoritative Response |
| :--- | :--- |
| *"Are you certified under FIPS 140-3 or approved by the Bank of England?"* | **"No, and no vendor should claim they are.** Central bank trust federation (`BLK-001`) and accredited CMVP laboratory certification (`BLK-002`) are deliberate external prerequisites. That is why our platform maintains an explicit **PRODUCTION BLOCKED** badge. Our code implements NIST FIPS 204 algorithms and passes all Power-On Self-Tests (POST), but we require institutional sandbox validation before connecting to live clearing." |
| *"Why should we pay £15,000 for a Discovery before doing a PoV?"* | **"The Discovery protects your time and budget.** It scopes the exact message flows, reviews your hardware KMS/HSM policies, and establishes written, measurable acceptance criteria. Without Discovery, PoVs drift and waste internal engineering resources. If the Discovery reveals that immediate migration isn't necessary, you save the cost of a full sandbox deployment." |
| *"Do you store private keys in the cloud?"* | **"Zero plaintext key material is ever persisted.** We use hardware-enforced envelope encryption (AWS KMS / CloudHSM). The private keys are decrypted directly into memory buffers that zeroize on drop. If an attacker extracts the on-disk storage file, they only see AES-GCM ciphertext and a KMS-wrapped DEK." |
| *"What is the commercial progression if the PoV succeeds?"* | **"Transparent, fixed-tier licensing:** Discovery is £15,000; the bounded Technical PoV is £65,000; and production licensing starts at Foundation (£360,000/yr) up to Advanced Resilience (£1,200,000/yr) for high-availability clustered deployments." |
