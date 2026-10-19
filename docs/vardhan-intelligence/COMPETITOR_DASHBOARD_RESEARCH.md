# COMPETITOR DASHBOARD RESEARCH — VARDHAN Q-CORE Intelligence-Plane Upgrade Drivers

> **Purpose:** Live-web research on competitor dashboards/product pages across 4 categories to drive the VARDHAN Q-CORE control-plane + intelligence-plane dashboard upgrade.
> **Q-CORE baseline for comparison:** hybrid signatures Ed25519+ML-DSA, ML-KEM key exchange, Raft HA clustering, Merkle-ledger audit receipts, control-plane + intelligence-plane dashboard, enterprise tenant isolation, evidence/sealing workflows for banks.
> **Date:** 2026-10-17 · Research Specialist · Live web-search + web-browse verified
> **Method:** `web-search` + `web-browse` on product/docs pages listed per entry. URLs verified live at research time.

---

## Table of Contents

- [Category 1 — Post-Quantum Cryptography Platforms](#category-1--post-quantum-cryptography-platforms)
  - [1.1 QuSecure — QuProtect R3](#11-qusecure--quprotect-r3)
  - [1.2 SandboxAQ — AQtive Guard (Unified Cryptography Management)](#12-sandboxaq--aqtive-guard-unified-cryptography-management)
  - [1.3 PQShield — PQPlatform](#13-pqshield--pqplatform)
  - [1.4 evolutionQ — BasejumpQDN (+ Basejump platform)](#14-evolutionq--basejumpqdn--basejump-platform)
  - [1.5 QuintessenceLabs — qTrust / TSF / qConnect / QRNG portfolio](#15-quintessencelabs--qtrust--tsf--qconnect--qrng-portfolio)
  - [1.6 Thales — CPL PQC + CipherTrust Manager + Luna HSM](#16-thales--cpl-pqc--ciphertrust-manager--luna-hsm)
  - [1.7 Arqit — QuantumCloud (symmetric-key agreement platform)](#17-arqit--quantumcloud-symmetric-key-agreement-platform)
  - [1.8 Keyfactor (InfoSec Global) — AgileSec Analytics](#18-keyfactor-infosec-global--agilesec-analytics)
- [Category 2 — Quantum-Safe / PQC Migration Discovery Tools](#category-2--quantum-safe--pqc-migration-discovery-tools)
  - [2.1 IBM Quantum Safe Explorer](#21-ibm-quantum-safe-explorer)
  - [2.2 IBM Quantum Safe Remediator](#22-ibm-quantum-safe-remediator)
  - [2.3 IBM Guardium Quantum Safe / Guardium Cryptography Manager (GCM)](#23-ibm-guardium-quantum-safe--guardium-cryptography-manager-gcm)
  - [2.4 SandboxAQ AQtive Guard sensors + Open Cryptography inventory](#24-sandboxaq-aqtive-guard-sensors--open-cryptography-inventory)
  - [2.5 evolutionQ BasejumpSIM (simulation companion to BasejumpQDN)](#25-evolutionq-basejumpsim-simulation-companion-to-basejumpqdn)
- [Category 3 — Audit / Receipt & Evidence Platforms for Banking](#category-3--audit--receipt--evidence-platforms-for-banking)
  - [3.1 DORA compliance dashboards & tooling (EU Digital Operational Resilience Act)](#31-dora-compliance-dashboards--tooling-eu-digital-operational-resilience-act)
  - [3.2 SWIFT Customer Security Programme (CSP) / CSCF + KYC-SA attestation](#32-swift-customer-security-programme-csp--cscf--kyc-sa-attestation)
  - [3.3 Governance evidence packs (governancedocs-style SWIFT/DORA toolkits)](#33-governance-evidence-packs-governancedocs-style-swiftdora-toolkits)
- [Category 4 — HA / Cluster + Merkle-Ledger Observability Dashboards](#category-4--hacluster--merkle-ledger-observability-dashboards)
  - [4.1 HashiCorp Vault UI + Raft Integrated Storage + Autopilot](#41-hashicorp-vault-ui--raft-integrated-storage--autopilot)
  - [4.2 HashiCorp Consul Server Dashboard (Grafana) + Autopilot](#42-hashicorp-consul-server-dashboard-grafana--autopilot)
  - [4.3 etcd observability (Prometheus + Grafana etcd dashboard + OTel)](#43-etcd-observability-prometheus--grafana-etcd-dashboard--otel)
  - [4.4 Sigstore Rekor transparency log + Rekor Search + rekor-monitor](#44-sigstore-rekor-transparency-log--rekor-search--rekor-monitor)
- [Cross-Cutting Synthesis — What Q-CORE Should Steal](#cross-cutting-synthesis--what-q-core-should-steal)
- [Pricing / Engagement Model Summary Table](#pricing--engagement-model-summary-table)
- [Research Log (queries executed)](#research-log-queries-executed)

---

## Category 1 — Post-Quantum Cryptography Platforms

### 1.1 QuSecure — QuProtect R3

- **Product + URL:** QuSecure QuProtect R3 — https://www.qusecure.com/quprotect/
- **Category:** PQC platform (software-only, network-layer PQC + crypto-agility orchestration)
- **Dashboard / feature capabilities:**
  - **Cryptographic Command & Control console:** top strip with Recon / Resilience / Reporting pillars; counts of **assets discovered, policy violations, agents deployed, secure connections** plus a **cryptographic risk score with analysis + recommendation** (hero screenshot on product page).
  - **R1 Recon — discovery & inventory:** passive sensors observe live network traffic; inventory of algorithms, protocols, certificates, key sizes; ranked **by exposure, not by count**; JA3/JA4 TLS client fingerprinting (https://www.qusecure.com/quprotect/).
  - **R2 Resilience — policy-driven crypto-agility engine:** admin sets algorithm policy in Orchestrator → distributed to every encryptor → connections renegotiate while traffic flows; **single-click cipher/key/algorithm rotation with no code changes or downtime** (corroborated: https://quantumzeitgeist.com/qusecure-post-quantum-cryptography-crypto-agility/).
  - **R3 Reporting — audit-ready CBOM:** on-demand **CycloneDX v1.6 Cryptography Bill of Materials** generated from live sensor inventory for auditors / federal crypto-inventory submission.
  - **Algorithm panel:** ML-KEM (FIPS 203, incl. ML-KEM-1024 for CNSA 2.0), ML-DSA (FIPS 204, e.g. ML-DSA-65), hybrid PQ-TLS X25519MLKEM768, classical interop (P-256, RSA, X25519), FIPS 140-3 mode; PQ-TLS/PQ-mTLS with classical fallback; TLS 1.3/TCP/gRPC/HTTP.
  - **Data-plane topology:** sensors + encryptors under one Orchestrator; sidecar service-mesh or gateway data plane (maps to NIST CSWP 39-upd1 §4.3/§4.6, cited on page); automated cert provisioning/rotation.
  - **Platform/compliance posture:** cloud / hybrid / on-prem / **air-gapped**; DoD IL2 (IL6 sponsored via AF TACFI); CNSA 2.0 aligned; PCI DSS 4.0 + federal inventory support; SIEM/SOAR + vuln-scanner integrations.
  - **Positioning clarity:** explicitly "not QKD, not a discovery point tool, not app rewrite, not data-at-rest" — complementary to EDR/SIEM/CASB/cert-managers.
- **Pricing / engagement:** **Priced on estate during evaluation** ("typically a small share of conventional rip-and-replace program"); book-a-demo motion; federal purchase via **Carahsoft GSA MAS 47QSWA18D008F, SEWP V, ITES-SW2, NASPO, OMNIA**; listed on **AWS Marketplace (incl. ICMP for US Intelligence Community)** — see https://aws.amazon.com/marketplace/pp/prodview-t5hd7piophvgi and YouTube brief https://www.youtube.com/watch?v=XEsAu6P5Uvc.

### 1.2 SandboxAQ — AQtive Guard (Unified Cryptography Management)

- **Product + URL:** SandboxAQ AQtive Guard — https://www.aqtiveguard.com/ · Docs: https://aqtiveguard.sandboxaq.com/docs/ (original release; current SaaS guide at https://docs.aqtiveguard.com/)
- **Category:** Unified Cryptography Management / Cryptographic Posture Management (discover → assess → remediate → prove)
- **Dashboard / feature capabilities:**
  - **Universal cryptographic inventory:** correlates code + runtime + network; finds managed certs, hidden algorithms, shadow keys/algorithms with zero manual effort; sensors documented under Sensors section of docs.
  - **Context-aware risk view:** every key/cert/algorithm mapped to **owners, dependencies, blast radius**; business-risk prioritization ("which assets carry the most business risk").
  - **Active orchestration & remediation:** **impact simulation + risk scoring** before rotation; orchestrated key rotations, algorithm replacements, PQC migrations; messaging around eliminating $9k/min cert-outage change anxiety.
  - **Policy-driven compliance & proof:** continuous compliance tracking, exportable reporting, **complete CBOM generation** proving progress vs **CNSA 2.0, NIST mandates, internal policies**; countdown framing ("PQC deadline," CNSA 2.0 software-by-2030 / full legacy replacement by 2033 per site).
  - **Vulnerability/compliance analysis:** flags weak/expired/unmanaged crypto today (MD5, SHA-1, DES, RC4, short RSA, expired certs, unencrypted private keys, short keys) — pre-quantum risk surfaced alongside quantum risk.
  - **Web Interface + API + integrations/plugins guides:** documented IA (Getting Started → Fundamentals → Web Interface → API → Sensors → Integrations & Plugins → Changelog); ServiceNow-style integrations and automation hooks.
  - **Unified control plane framing:** "shift from reactive to proactive," single control plane bridging finding → fixing (vs point cert-managers or static scanners) — see https://www.sandboxaq.com/post/sandboxaq-redefines-cybersecurity-with-unified-cryptography-management.
- **Pricing / engagement:** Contact-sales / demo motion; CPM checklist gated asset; partner channel (see /partners); open-education funnel (YouTube PQC playlist, Guides & eBooks, opencryptography.com OSS tools). No public list price.

### 1.3 PQShield — PQPlatform

- **Product + URL:** PQShield — https://pqshield.com/ · Third-party profile: https://qtonicquantum.com/lab/solutions/pqshield-platform · Co-processor partner page: https://www.latticesemi.com/en/Products/DesignSoftwareAndIP/IntellectualProperty/IPCore/PQShield/pq_Platform_co
- **Category:** PQC implementation platform (NIST-standards co-author team; side-channel-hardened HW IP + SW libraries) — **not a fleet dashboard vendor**
- **Dashboard / feature capabilities (what they expose instead of a console):**
  - **Standards pedigree as trust surface:** team co-authored NIST PQC standards; FIPS 203/204/205-aligned implementations.
  - **PQPlatform-CoPro coprocessor IP:** hash- + lattice-based PQC offload subsystem with optional non-invasive SCA countermeasures (Lattice Semi partner listing).
  - **Side-channel & formal-verification evidence:** TVLA-tested masking countermeasures; formally verified implementations (per Qtonic profile).
  - **HW/SW coverage matrix:** FPGA/ASIC IP + software libraries for chips, applications, cloud — "quantum-safe crypto on chips, in apps, in cloud."
  - **Migration enablement posture:** positioned as the cryptographic primitive supplier (OEM/embed), not the inventory/migration console — gap Q-CORE can exploit (PQShield has no Recon/Resilience/Reporting console equivalent).
  - **Comparison surface (third-party):** vs EigenQ PQC+ (hardware-anchored PQC, VPN/SDN/edge) on https://cybersectools.com/compare/eigenq-pqctm-vs-pqshield — useful for competitive framing.
- **Pricing / engagement:** IP-license / engagement model (OEM, silicon vendor, enterprise embed); no public dashboard pricing; contact/partnership motion.

### 1.4 evolutionQ — BasejumpQDN (+ Basejump platform)

- **Product + URL:** evolutionQ BasejumpQDN — https://www.evolutionq.com/products/basejumpqdn · Overview PDF via CDN; company: https://www.evolutionq.com/
- **Category:** Quantum Delivery Network (QDN) software — QKD-integrating key-exchange overlay for telco/utility/cloud/gov/enterprise high-speed networks
- **Dashboard / feature capabilities (explicit dashboard panel on product page):**
  - **BasejumpQDN monitoring dashboard** tracks six named panels: **key usage by external applications; virtual QKD key-swap throughput; QNL key-swap pool state; keys available to external applications; virtual QKD key-swap latency; physical QKD buffered key levels** (screenshot at /products/basejumpqdn; also summarized on https://cybersectools.com/tools/basejumpqdn).
  - **Intelligent key routing:** delivers keys where/when required; optimizes availability; minimizes paired-device count (cost + reliability story).
  - **Trusted → zero-trust repeater evolution:** extend fibre QKD range via certified trusted repeater nodes today; upgrade path to zero-trust quantum repeaters (no physical-security/cert cost).
  - **Vendor-neutral / crypto-agile architecture:** multi-vendor QKD devices; algorithms/key sizes changeable over time (per overview PDF).
  - **Risk-advisory services layer:** Quantum Risk Assessment, Executive Workshop, Roadmap & Strategy — dashboard is ops-focused, migration strategy is services-led.
- **Pricing / engagement:** "Schedule a product introduction" demo motion; deployment-stage product (in deployment today); no public pricing.

### 1.5 QuintessenceLabs — qTrust / TSF / qConnect / QRNG portfolio

- **Product + URLs:** Home — https://www.quintessencelabs.com/ · Products — https://www.quintessencelabs.com/products · TSF datasheet: https://www.quintessencelabs.com/hubfs/PDFs/QuintessenceLabs-TSF-Family-Product-Sheet.pdf · qConnect sheet: https://info.quintessencelabs.com/hubfs/PDFs/QuintessenceLabs-qConnect-Quantum-Safe-Key-Distributor-Product-Sheet.pdf
- **Category:** Quantum-enhanced key generation / distribution / management (QRNG + QKD + KMIP key manager)
- **Dashboard / feature capabilities (inferred from product sheets — no public console screenshots):**
  - **Trusted Security Foundation (TSF 100/200) key & policy manager:** VM or hardware appliance; **full-lifecycle key management, object + user policy management, built-in replication up to 16 nodes for HA** (TSF sheet).
  - **qConnect Quantum-Safe Key Distributor:** supports **both PQC and QKD** for data protection; flexibility story for migration pacing.
  - **qRNG / QRNG hardware:** quantum random number generation as root of trust for keys.
  - **CV-QKD technology:** continuous-variable QKD positioned as physics-guaranteed distribution (brochure: Quantum-Resilience-Delivered).
  - **Portfolio gap vs Q-CORE:** strong key-lifecycle + HA replication, but no public fleet crypto-inventory / CBOM / Merkle-receipt evidence surface — Q-CORE's ledger + CBOM + tenant isolation is differentiating.
- **Pricing / engagement:** Appliance + license enterprise sale; support portal at /support; no public pricing.

### 1.6 Thales — CPL PQC + CipherTrust Manager + Luna HSM

- **Product + URLs:** PQC agility — https://cpl.thalesgroup.com/encryption/post-quantum-crypto-agility · CipherTrust Manager — https://cpl.thalesgroup.com/encryption/ciphertrust-manager · PQC migration services — https://www.thalesgroup.com/en/solutions-catalogue/cybersecurity/cybersecurity-services/post-quantum-cryptography-migration · White paper — https://cpl.thalesgroup.com/resources/encryption/post-quantum-cryptography-solutions-white-paper
- **Category:** Enterprise encryption / key management / HSM incumbent adding PQC crypto-agility
- **Dashboard / feature capabilities:**
  - **CipherTrust Manager central console:** centrally manage encryption keys, configure security policies, **granular access control**; central management point for CipherTrust Data Security Platform (incl. TCT variant https://www.thalestct.com/ciphertrust-data-security-platform/ciphertrust-manager/).
  - **HSM-backed key protection:** KEK chain inside HSM-backed manager; Luna HSM integration; "prevailing cloud tech, REST + microservices" architecture (thalesdocs admin guides).
  - **PQC strategy framing:** decade+ research, NIST PQC process engagement; **structured PQC journey: assess quantum risk → migration roadmap → deploy quantum-resistant solutions → continuous monitoring for crypto-agility** (migration service page).
  - **Compliance/admin surface:** cloud-friendly deployment/scale, simplified administration, compliance assurance posture; docs portal at thalesdocs.com.
- **Pricing / engagement:** Enterprise license + HSM hardware + professional services (migration roadmap engagements); no public list pricing.

### 1.7 Arqit — QuantumCloud (symmetric-key agreement platform)

- **Product + URL:** Arqit QuantumCloud (product page not directly retrievable in this pass — search returned no usable excerpt; company domain arqit.uk; treat as secondary source)
- **Category:** Symmetric-key agreement / quantum-safe key platform (no-QKD, cloud-issued keys)
- **Dashboard / feature capabilities (to verify in follow-up pass):**
  - Historically: tenant/key inventory, policy/role management, endpoint enrollment, key-lifecycle status — **not confirmed in this research pass** (no live excerpt captured).
  - **Recommendation for Q-CORE:** do not cite Arqit console specifics without a follow-up browse; position as key-distribution alternative to Q-CORE's ML-KEM exchange until verified.
- **Pricing / engagement:** Enterprise subscription (unverified this pass).

### 1.8 Keyfactor (InfoSec Global) — AgileSec Analytics

- **Product + URLs:** Docs — https://docs.keyfactor.com/agilesec/latest · ServiceNow listing — https://store.servicenow.com/store/app/9d4bef2a1b246a50a85b16db234bcb30 · CrowdStrike listing — https://marketplace.crowdstrike.com/listings/infosec-global-agilesec-analytics/
- **Category:** Cryptographic discovery & analysis (now Keyfactor AgileSec; ex-InfoSec Global ISG)
- **Dashboard / feature capabilities:**
  - **Discovery + inventory of crypto across cloud + on-prem landscapes:** scan core systems, build cryptographic-asset inventory (machines identities + mechanisms).
  - **Hidden-vulnerability detection:** surface misconfigurations/weak crypto proactively.
  - **Cryptographic-health monitoring:** continuous posture view (ServiceNow: "proactively monitor cryptographic health").
  - **Compliance + PQC-readiness acceleration:** reduce risk, simplify compliance, accelerate post-quantum readiness (CrowdStrike listing).
  - **Ecosystem integrations:** ServiceNow, IBM Data Risk Manager import (https://www.ibm.com/docs/en/data-risk-manager/2.0.6?topic=cpi-integrating-infosec-global-agilesec-analytics-data-risk-manager), Microsoft Security Store connector.
- **Pricing / engagement:** Enterprise license via Keyfactor; marketplace listings (ServiceNow, CrowdStrike, Microsoft Security Store); no public list price.

---

## Category 2 — Quantum-Safe / PQC Migration Discovery Tools

### 2.1 IBM Quantum Safe Explorer

- **Product + URLs:** Overview — https://www.ibm.com/docs/en/quantum-safe/quantum-safe-explorer/2.x?topic=quantum-safe-explorer-overview · Dashboards (GDSC 3.x) — https://www.ibm.com/docs/en/gdsc/3.x?topic=reports-dashboards (403 on anon fetch; summary via search excerpt) · CBOM blog — https://community.ibm.com/community/user/blogs/ulyati-jaya1/2026/10/15/building-a-cbom-with-ibm-quantum-safe-explorer · Tech brochure — https://quantum-infinite.com/wp-content/uploads/2023/12/IBM_Quantum-Safe-Technology-Brochure-2.pdf
- **Category:** Code + infrastructure crypto-discovery (source/object-code scanner → CBOM → risk)
- **Dashboard / feature capabilities:**
  - **Quantum Safe – Summary dashboard (landing view):** "comprehensive, high-level overview of org cryptographic security across network and application layers" (GDSC docs excerpt).
  - **Artifact discovery:** scans **source + object code** to identify cryptographically relevant artifacts, uncover dependencies, surface quantum-vulnerable usage.
  - **CBOM construction:** combine app-level discovery with enterprise inventory/governance to show **which algorithms exist, where used, what business services depend on them** (Oct 2026 community blog).
  - **Risk + policy framing (via GCM linkage):** feeds Guardium Cryptography Manager inventory enriched with violation findings (see 2.3).
- **Pricing / engagement:** IBM licensed software (Explorer standalone + Guardium bundle); GCM bootcamp/workshop motion at https://ibm.github.io/gcm-bootcamp/; no public list price.

### 2.2 IBM Quantum Safe Remediator

- **Product + URL:** Overview — https://www.ibm.com/docs/en/quantum-safe/quantum-safe-remediator/1.1.x?topic=overview
- **Category:** PQC remediation + performance validation companion to Explorer
- **Dashboard / feature capabilities:**
  - **Remediation workflows** acting on Explorer findings (remediate vulnerable crypto identified in scans).
  - **Performance harness tool:** evaluate **performance of PQC algorithms** (throughput/latency impact) before cutover — distinctive vs pure-inventory tools; Q-CORE should mirror with ML-KEM/ML-DSA perf panels.
- **Pricing / engagement:** IBM licensed; bundled with Quantum Safe portfolio; no public list price.

### 2.3 IBM Guardium Quantum Safe / Guardium Cryptography Manager (GCM)

- **Product + URLs:** GCM — https://www.ibm.com/products/guardium-cryptography-manager · Guardium Quantum Safe (GDSC docs, 403 anon) · CDW datasheet (PDF) — https://webobjects2.cdw.com/is/content/CDW/cdw/on-domain-cdw/brands/ibm/ibm-guardium-cryptography-manager-data-sheet.pdf · Launch coverage — https://quantumcomputingreport.com/ibm-introduces-guardium-cryptography-manager-to-address-pqc-migration/ · Workshop — https://ibm.github.io/gcm-bootcamp/
- **Category:** Enterprise cryptographic inventory + policy + migration governance (Oct 2025 GCM launch; expands Guardium Quantum Safe assessment product)
- **Dashboard / feature capabilities:**
  - **Enterprise crypto-visibility:** cryptographic usage across enterprise; in-depth risk/vulnerability analysis; **robust policy enforcement + alerting** to manage crypto assets.
  - **Enriched inventory graph:** inventory enriched with **violation findings + usage data from Explorer + network scans**; models **relationships between assets and crypto objects (e.g., servers → SSL/TLS certs)** to simplify risk + compliance.
  - **Migration governance:** analyze risk, define quantum-safe policies, manage migration of crypto assets (bootcamp labs: discover → CBOM → risk → policy → migrate).
  - **Positioning:** "achieve crypto-agility, encrypt sensitive data, prepare for PQC readiness" (GCM product page).
- **Pricing / engagement:** IBM Guardium licensed suite; workshop/bootcamp enablement; channel datasheet via CDW; no public list price.

### 2.4 SandboxAQ AQtive Guard sensors + Open Cryptography inventory

- **Product + URLs:** https://aqtiveguard.sandboxaq.com/docs/ · https://www.aqtiveguard.com/ · OSS: https://opencryptography.com/
- **Category:** Multi-source discovery fabric (code/runtime/network sensors) + open tooling funnel
- **Dashboard / feature capabilities:**
  - **Sensor-documented architecture:** dedicated Sensors section in docs; integrations/plugins guide for scaling + automation.
  - **Correlation across code, runtime, network** (vs legacy PKI tools that only see managed certs).
  - **Open Cryptography OSS tools** as top-of-funnel visibility aids + education (guides/ebooks, PQC training playlist).
- **Pricing / engagement:** Platform subscription (contact sales); OSS tools free.

### 2.5 evolutionQ BasejumpSIM (simulation companion to BasejumpQDN)

- **Product + URL:** Described inline at https://www.evolutionq.com/products/basejumpqdn
- **Category:** Quantum-key-network simulation (pre-deployment planning)
- **Dashboard / feature capabilities:**
  - **Cloud simulation of QKD topologies:** model devices over fibre/satellite links, topologies, traffic scenarios; forecast key-capacity needs.
  - **Failure/what-if analysis:** device slowdown/failure impact; tune performance/capacity before capex.
  - **Demo-network fast path:** build quantum-safe demo network on existing devices to test app use cases.
- **Pricing / engagement:** Services-led (paired with BasejumpQDN intro); no public pricing.

---

## Category 3 — Audit / Receipt & Evidence Platforms for Banking

### 3.1 DORA compliance dashboards & tooling (EU Digital Operational Resilience Act)

- **Product + URLs:** DORA Dashboard (compliance tracker) — https://dora-dashboard.com/ · Regulation-DORA scorer — https://www.regulation-dora.eu/dora-dashboard · Checklist/guide — https://governancedocs.com/dora-compliance-checklist/ · Vendor-risk explainer — https://www.neotas.com/dora-compliance-requirements/
- **Category:** Operational-resilience compliance evidence (banking/FS mandatory since Jan 2025 enforcement)
- **Dashboard / feature capabilities (what these tools show — Q-CORE evidence-plane parity targets):**
  - **Live pillar scores:** clause / incident / assessment monitoring with live scores; workflow execution trends + system metrics (dora-dashboard.com).
  - **Five-evidence framing (governancedocs checklist):** board-owned ICT risk-management framework; **incident classification + reporting process; resilience testing programme; controlled ICT third-party relationships; governance/accountability** — each must be *evidenced*, not asserted.
  - **ICT risk + incident views:** workflow executions, contract updates, document uploads tracked as operational-resilience tooling.
  - **Article 28 vendor-risk / Register of Information readiness:** ICT vendor due diligence, screening, third-party risk mgmt, register readiness (Neotas).
  - **Self-score + action plan + benchmarks:** 5-minute assessment across 5 pillars with personalised action plan + sector benchmarks (regulation-dora.eu).
  - **Note:** "DORA Metrics Dashboard" (linearb.io) refers to *DevOps* DORA (deployment frequency etc.) — distinct from EU DORA; do not conflate in Q-CORE messaging.
- **Pricing / engagement:** Mix of free scorer tools + paid compliance suites/toolkit sales; no single list price.

### 3.2 SWIFT Customer Security Programme (CSP) / CSCF + KYC-SA attestation

- **Product + URLs:** CSP hub — https://www.swift.com/myswift/customer-security-programme · KYC-SA attestation — https://www.swift.com/myswift/customer-security-programme/submit-kyc-security-attestation · CSCF v2026 checklist — https://governancedocs.com/swift-csp-compliance-checklist/ · Attestation steps — https://governancedocs.com/swift-csp-attestation/ · Practitioner guide — https://fscom.co/insights/blog/preparing-for-swift-csp-attestation-a-practical-guide-for-financial-institutions/
- **Category:** Mandatory bank security-attestation regime (annual attestation + independent assessment)
- **Dashboard / feature capabilities (MySWIFT-side + evidence-pack expectations):**
  - **KYC-Security Attestation workflow:** annual submission confirming alignment with **mandatory controls**; transparency across community; **must be supported by independent assessment**.
  - **CSCF control coverage (v2026: architecture type + 26 mandatory controls):** scope → implement → evidence → assess → attest cycle.
  - **Evidence-pack contents (toolkit mirror):** self-attestation workbook + independent-assessment evidence pack; control implementation summary; **secure-zone architecture diagram; access-control/operator-session policies; network segmentation; cryptography & key-management evidence** (governancedocs toolkit description).
  - **Evidence-based security expectation:** scope controls, implement with evidence, submit on time (fscom guide) — maps directly to Q-CORE's seal/evidence workflows.
- **Pricing / engagement:** SWIFT membership-driven (no per-dashboard price); third-party toolkit/consulting sold separately.

### 3.3 Governance evidence packs (governancedocs-style SWIFT/DORA toolkits)

- **Product + URLs:** https://governancedocs.com/swift-csp-attestation/ · https://governancedocs.com/swift-csp-compliance-checklist/ · https://governancedocs.com/dora-compliance-checklist/
- **Category:** Template/evidence-pack accelerators banks buy to satisfy 3.1–3.2
- **Dashboard / feature capabilities:**
  - **31-template SWIFT cycle pack:** attestation workbook, assessment evidence pack, implementation summary, architecture diagram template, policy set.
  - **DORA 5-pillar checklist mapping** to evidencing steps.
- **Pricing / engagement:** Toolkit license (template pack sale); Q-CORE opportunity: **native, machine-generated evidence > static templates** (Merkle receipts + CBOM + sealed exports).

---

## Category 4 — HA/Cluster + Merkle-Ledger Observability Dashboards

### 4.1 HashiCorp Vault UI + Raft Integrated Storage + Autopilot

- **Product + URLs:** Seal status API — https://developer.hashicorp.com/vault/api-docs/system/seal-status · Status CLI — https://developer.hashicorp.com/vault/docs/commands/status · Autopilot — https://developer.hashicorp.com/vault/docs/concepts/integrated-storage/autopilot · Explainer — https://prepare.sh/articles/hashicorp-vault-architecture-seal-unseal-and-raft-storage-explained · Reference deploy — https://github.com/Rahul3658/vault_cluster
- **Category:** Secrets-management HA cluster observability (closest operational analogue to Q-CORE Raft HA + sealing)
- **Dashboard / feature capabilities:**
  - **Seal-status surface:** `vault status` / `/sys/seal-status` (unauthenticated) shows **sealed?, HA mode, shares/threshold, leader, Raft state** — Q-CORE's seal/unseal + leader panels should match this at minimum.
  - **Autopilot State API:** single-call **per-node Raft health** (voter/non-voter, healthy/unhealthy via heartbeat + replication-lag judgments).
  - **Server stabilization:** new voters join as non-voters, promoted after `server_stabilization_time` health window — prevents flapping quorum.
  - **Dead-server cleanup:** auto-remove unhealthy nodes past `dead_server_last_contact_threshold` above `min_quorum` (default off; high-threshold guidance, esp. with HSM).
  - **Enterprise HA extras:** automated upgrades (version-weighted voter promotion + leadership transfer), redundancy zones (one voter + N non-voters per AZ with auto-failover), DR/performance secondary autopilot.
  - **Health judgments:** follower health = heartbeat recency (`last_contact_threshold` 10s) + replication lag (`max_trailing_logs` 1000).
- **Pricing / engagement:** Vault OSS (free) + Vault Enterprise (per-client license; HSM/autopilot-enterprise features gated); self-hosted/Docker-Compose reference free.

### 4.2 HashiCorp Consul Server Dashboard (Grafana) + Autopilot

- **Product + URLs:** Server dashboard — https://developer.hashicorp.com/consul/docs/observe/grafana/server · Autopilot — https://docs.hashicorp.com/consul/tutorials/archive/autopilot-datacenter-operations · Metrics collection — https://oneuptime.com/blog/post/2026-02-06-consul-health-metrics-prometheus/view
- **Category:** Service-mesh / KV HA observability (Raft + Envoy sidecar telemetry)
- **Dashboard / feature capabilities:**
  - **Raft panels:** state transitions (leader-election frequency as instability signal), quorum health, peer list, autopilot health checks.
  - **Agent/service health:** Prometheus-scraped agent health, service checks, KV ops, Envoy sidecar proxy performance.
  - **Autopilot ops:** stable-server introduction, dead-server cleanup, datacenter-aware management.
  - **Grafana-packaged queries:** prebuilt queries per metric with descriptive guidance (e.g., "frequent transitions → investigate instability").
- **Pricing / engagement:** Consul OSS + Enterprise; Grafana dashboards free; OTel/Prometheus self-hosted.

### 4.3 etcd observability (Prometheus + Grafana etcd dashboard + OTel)

- **Product + URLs:** Monitoring guide — https://etcd.io/docs/v3.5/op-guide/monitoring/ · Grafana dashboard — https://grafana.com/grafana/dashboards/3070-etcd/ · Health-metrics guide — https://oneuptime.com/blog/post/2026-02-06-etcd-cluster-health-metrics/view · Lightweight monitor — https://github.com/domac/etcdmonitor
- **Category:** Reference Raft KV-store telemetry (the baseline every Raft dashboard is judged against)
- **Dashboard / feature capabilities:**
  - **/metrics + /health endpoints** (Prometheus scrape, optional separate metrics listener for LB/monitoring with mTLS).
  - **Raft-core metrics:** leader elections, proposals (commit/apply rates), trailing-logs lag, DB size/quota, fsync latency, network round-trips.
  - **Grafana "Etcd by Prometheus" (ID 3070):** out-of-box cluster-health panels; ACK/Grafana-Cloud variants add CPU-per-member, leader-status, consensus-latency views.
  - **OTel distributed tracing (v3.5+, experimental):** sampling-rate-tuned span collection for request-flow diagnosis.
  - **Debug surface:** `/debug/pprof` CPU/heap/mutex/goroutine profiling (debug log-level gated).
- **Pricing / engagement:** OSS (Apache 2.0); Grafana Cloud free tier + paid; self-hosted Prometheus free.

### 4.4 Sigstore Rekor transparency log + Rekor Search + rekor-monitor

- **Product + URLs:** Rekor repo — https://github.com/sigstore/rekor · Logging overview — https://docs.sigstore.dev/logging/overview/ · Logging docs — https://docs.sigstore.dev/logging/ · **Rekor Search UI — https://search.sigstore.dev/** · rekor-monitor — https://github.com/sigstore/rekor-monitor · Verification deep-dive — https://deepwiki.com/jdx/sigstore-verification/10.1-rekor-transparency-log-verification
- **Category:** Merkle-backed transparency-log / audit-receipt observability (direct analogue to Q-CORE Merkle-ledger receipts)
- **Dashboard / feature capabilities:**
  - **Append-only signed-entry log:** hashedrekord + PKI/manifest-flexible schemas; CLI to create/verify entries, query **inclusion proof, integrity verification, retrieval by public key or artifact**.
  - **Rekor Search UI:** lookup by **email (SAN identity), artifact, public key** — minimal, fast, public-good UX Q-CORE's receipt explorer should surpass (add tenant scoping, bank-evidence filters, inclusion-proof badges).
  - **rekor-monitor (GitHub Actions reusable workflow):** hourly **consistency verification (immutability/append-only)** + identity-watched alerting (SAN + OIDC issuer match); artifacts retained longer than cron cadence.
  - **Ecosystem watchdog framing:** logs are **tamper-evident, not tamper-proof** — monitoring is mandatory; Fulcio CT log provides cert-side discoverability/auditability alongside Rekor.
- **Pricing / engagement:** Public-good OSS (free; Sigstore public instance free); self-hostable; monitor runs on user's GitHub Actions minutes.

---

## Cross-Cutting Synthesis — What Q-CORE Should Steal

1. **QuProtect-style "3 R" console header (Recon / Resilience / Reporting) + risk score.** Q-CORE intelligence-plane should keep its control/intelligence split but add a persistent top strip: assets discovered · policy violations · nodes/agents · secure connections (ML-KEM) · hybrid-signature verification rate · ledger inclusion rate — with one cryptographic-risk score + recommended next action. This is the single most copy-worthy pattern.
2. **AQtive Guard context-aware risk (owner/dependency/blast-radius) + impact simulation.** Q-CORE inventory rows should carry tenant, owner, dependency chain, blast radius, and a "simulate rotation/migration" dry-run with risk score before executing ML-KEM/ML-DSA cutover.
3. **IBM GCM relationship graph (asset → crypto object).** Add server→cert, service→key, tenant→policy edges to Q-CORE inventory; enrich with Explorer-equivalent findings (source/object scan) + network-sensor findings in one view.
4. **IBM Remediator performance harness.** Add ML-KEM/ML-DSA perf panels (handshake latency, throughput, cert-size overhead) so banks approve cutover with data.
5. **BasejumpQDN six-panel ops view.** Mirror key-pool telemetry: keys available, consumption by app/tenant, swap throughput/latency, pool state, buffered levels — mapped to Q-CORE's ML-KEM session pool + Raft commit latency.
6. **DORA 5-evidence + SWIFT 26-control mapping.** Ship bank-evidence views that map each Merkle receipt/CBOM/seal event to DORA pillars and CSCF controls, with independent-assessor export (workbook + evidence pack, not just JSON).
7. **Vault/Consul/etcd Raft parity.** Minimum HA panels: seal status, leader, voter/non-voter per node, heartbeat age, trailing-log lag, stabilization window, dead-server cleanup state, quorum size, term/vote transitions, DB size, fsync/commit latency. Adopt Autopilot vocabulary (stabilization, quorum, trailing logs) so operators feel at home.
8. **Rekor Search + monitor parity, then exceed.** Receipt explorer searchable by tenant/artifact/key-ID/signer with inclusion-proof + consistency-check badges and hourly monitor workflow; emphasize tamper-evident + quorum-anchored (stronger than Rekor's tamper-evident-only story).
9. **Air-gap + marketplace readiness (QuProtect lesson).** Surface air-gapped deployment mode and federal/marketplace procurement path (GSA/SEWP-style, AWS Marketplace) in the dashboard's "deployment & procurement" view — banks and public sector ask first.
10. **CBOM everywhere (CycloneDX v1.6).** Every competitor converges on exportable CBOM as the auditor handshake. Q-CORE should generate tenant-scoped CBOMs on demand from live inventory + ledger receipts, versioned and sealed.

---

## Pricing / Engagement Model Summary Table

| Product | Model visible | Public price? | Notes |
|---|---|---|---|
| QuSecure QuProtect R3 | Estate-based eval pricing; demo-led; AWS Marketplace (incl. ICMP); Carahsoft GSA MAS, SEWP V, ITES-SW2, NASPO, OMNIA | No | "Small share of rip-and-replace" framing |
| SandboxAQ AQtive Guard | Contact-sales SaaS; partner channel; OSS/education funnel | No | CPM checklist gated; open-crypto OSS free |
| PQShield PQPlatform | IP license / OEM embed | No | No console; primitive-supplier motion |
| evolutionQ BasejumpQDN | Demo/deployment engagement + services | No | In-deployment; SIM bundled as planning aid |
| QuintessenceLabs portfolio | Appliance + license enterprise sale | No | TSF up to 16-node replication |
| Thales CipherTrust/Luna + PQC services | License + HSM HW + PS migration roadmaps | No | Structured PQC journey engagements |
| Arqit QuantumCloud | Enterprise subscription (unverified this pass) | No | Needs follow-up browse |
| Keyfactor AgileSec | Enterprise license; marketplace listings | No | ServiceNow/CrowdStrike/MSFT store presence |
| IBM Explorer / Remediator / GCM | IBM license suite + bootcamp enablement | No | GCM launched Oct 2025; workshop free |
| DORA tooling | Free scorers + paid suites/toolkits | Partial (free scorer) | EU-DORA vs DevOps-DORA naming trap |
| SWIFT CSP | Membership regime + paid toolkits/consulting | No (regime) | Annual KYC-SA + independent assessment |
| Vault/Consul/etcd | OSS + Enterprise tiers; dashboards free | Yes (OSS free) | Reference deploys/dashboards free |
| Sigstore Rekor | Public-good OSS | Yes (free) | Self-host + Actions-based monitor |

---

## Research Log (queries executed)

**Category 1:**
- `PQShield PQC platform dashboard features` → pqshield.com, qtonicquantum profile, LatticeSemi CoPro page, cybersectools compare
- `QuSecure QuProtect dashboard features crypto-agility` → qusecure.com/quprotect, quantumzeitgeist R3 piece, AWS Marketplace listing, YouTube brief
- `evolutionQ BasejumpQDN dashboard features` → evolutionq.com/products/basejumpqdn, cybersectools BasejumpQDN, quantum-aegis mirror, overview PDF
- `SandboxAQ AQtive Guard cryptography management` (retry of zero-result `AQtive Guard dashboard…` query) → aqtiveguard.com, aqtiveguard.sandboxaq.com/docs, sandboxaq.com unified-management post
- `Thales post-quantum cryptography solutions PQC` → CPL agility page, TCT quantum page, white paper, migration service
- `QuintessenceLabs dashboard quantum key management` → quintessencelabs.com, /products, TSF + qConnect sheets
- `Arqit QuantumCloud dashboard features` → no usable result (flagged for follow-up)
- `Thales CipherTrust Manager dashboard key management HSM` → CPL CipherTrust Manager, thalesdocs HSM/admin guides
- `InfoSec Global AgileSec Analytics dashboard cryptographic discovery` → Keyfactor docs, ServiceNow/CrowdStrike/MSFT listings, IBM DRM integration doc
- `PQShield PQC migration audit dashboard inventory` → PQCC workbook/MITRE (context), pqc-migration-audit OSS (context)
- `evolutionQ MultisigQ QuantumSafe dashboard` → no direct console info (noise results excluded)
- `QuintessenceLabs qTrust key management dashboard` → TSF replication detail

**Category 2:**
- `IBM Quantum Safe Explorer Remediator dashboard` → Remediator overview, GDSC dashboards excerpt, developer tutorial, tech brochure
- `IBM Guardium Quantum Safe cryptography inventory` → GCM product page, Guardium Quantum Safe docs excerpt, CDW datasheet PDF, GCM bootcamp, launch coverage
- `IBM Quantum Safe Explorer Summary dashboard cryptography inventory risk` → Explorer 2.x overview, GDSC dashboards, Oct 2026 CBOM blog, GCM bootcamp

**Category 3:**
- `DORA compliance dashboard ICT risk register evidence` → dora-dashboard.com, regulation-dora.eu scorer, governancedocs checklist, neotas Art.28
- `SWIFT CSP compliance dashboard attestation evidence` → MySWIFT CSP hub, KYC-SA page, governancedocs toolkit/checklist, fscom guide
- `DORA ICT register incident reporting dashboard banking compliance tool` → no usable result (covered by first DORA query)

**Category 4:**
- `HashiCorp Vault UI dashboard seal status raft cluster` → seal-status API, status CLI, seal/unseal+Raft explainer, 3-node Raft reference repo
- `Sigstore Rekor transparency log explorer dashboard monitor` → rekor repo, logging overview, rekor-monitor repo
- `etcd dashboard monitoring raft consensus metrics` → etcd monitoring guide, Grafana 3070 dashboard, OTel collector guides, etcdmonitor
- `HashiCorp Vault Consul UI telemetry dashboard raft autopilot` → Consul server dashboard, Vault autopilot, Consul autopilot, OTel Consul metrics
- `rekor search sigstore transparency log search entries verify` → logging overview, rekor repo, search.sigstore.dev

**Direct page browses:** qusecure.com/quprotect · aqtiveguard.com · aqtiveguard.sandboxaq.com/docs · evolutionq.com/products/basejumpqdn · IBM GDSC Guardium Quantum Safe docs (403 anon — used search excerpts + CDW/GCM alternates) · Vault autopilot concept page · search.sigstore.dev.

---

*End of report — generated from live web research 2026-10-17. Follow-ups recommended: (a) Arqit QuantumCloud console browse, (b) IBM GDSC docs via authenticated session (403 anon), (c) Thales CipherTrust Manager live demo screenshots, (d) Keyfactor AgileSec console screenshots for widget-level parity.*
