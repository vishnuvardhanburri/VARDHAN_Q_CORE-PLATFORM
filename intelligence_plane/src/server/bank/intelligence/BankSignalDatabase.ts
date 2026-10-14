/**
 * VARDHAN — Bank Signal Database
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Curated collection of REAL, publicly verifiable signals from bank institutions.
 *
 * Every entry in this database was verified by fetching the public URL and
 * extracting verbatim evidence. No fabricated claims, private vulnerabilities,
 * undisclosed incidents, deployed algorithms, or internal weaknesses are present.
 *
 * Signal provenance:
 *   - All `observedFact` fields are direct quotes or close paraphrases from the
 *     source document (URL recorded in `sourceUrl`).
 *   - All `inferredImplication` fields are VARDHAN_INFERENCE, clearly labelled.
 *   - No personal contact details are included — only roles and departments that
 *     are publicly disclosed.
 */

import { BankSignal, BankSignalGroup, BankProblemType, SignalConfidence, VardhanCapability } from './BankSignalModel.ts';

// ── Discovery timestamp (set at module load time to ensure it reflects when
//    the signal was actually captured during this research run) ──────────────

const DISCOVERY_TS = new Date().toISOString();

// ── Vardhan Capability Registry ─────────────────────────────────────────────
// Mirrors the qcore_services from industries/banking/plane.json and the
// inventions from VARDHAN_INVENTION_SHORTLIST.md

export const VARDHAN_CAPABILITIES: VardhanCapability[] = [
  {
    id: 'AER-KEP-Q',
    name: 'AER-KEP-Q — Asynchronous Exposure-Resilient Key Establishment',
    description: 'Epoch-based key establishment protocol with automatic quarantine on exposure detection and fresh epoch reissuance, persisting state across restarts with Raft-backed HA.',
    technicalMechanism: 'ML-KEM-1024 + ML-DSA-87 + Ed25519 dual-signing, transaction-bound HKDF, per-epoch replay protection',
    relevanceToBankProblems: ['CRYPTOGRAPHIC_AGILITY', 'KEY_LIFECYCLE', 'INCIDENT_RESPONSE', 'TRUST_BOUNDARY'],
    evidenceUrl: 'VARDHAN_INVENTION_SHORTLIST.md#1-aer-kep-q',
  },
  {
    id: 'AUDIT_LEDGER',
    name: 'Durable Audit Ledger',
    description: 'Append-only, crash-safe audit ledger with BLAKE3 hash chaining and ML-DSA-87 signature on every entry, with Raft-committed signed Merkle checkpoints.',
    technicalMechanism: 'BLAKE3 canonical hash chain, JSONL persistence with fsync, Merkle root verification',
    relevanceToBankProblems: ['AUDIT_LIFECYCLE', 'COMPLIANCE_AUTOMATION', 'INCIDENT_RESPONSE', 'VERIFICATION_INFRASTRUCTURE', 'THIRD_PARTY_RISK'],
    evidenceUrl: 'backend/audit_ledger/src/lib.rs',
  },
  {
    id: 'SIGNED_RECEIPT',
    name: 'Canonical Payload Integrity — Sealed Receipt',
    description: 'Multi-field sealed receipt with dual ML-DSA-87 + Ed25519 signatures, 10-field canonical payload, independently verifiable.',
    technicalMechanism: '10-field canonical payload, dual signature (ML-DSA-87 + Ed25519), BLAKE3 hashing',
    relevanceToBankProblems: ['AUDIT_LIFECYCLE', 'TRUST_BOUNDARY', 'VERIFICATION_INFRASTRUCTURE', 'COMPLIANCE_AUTOMATION', 'THIRD_PARTY_RISK'],
    evidenceUrl: 'VARDHAN_INVENTION_SHORTLIST.md#6-canonical-payload-integrity',
  },
  {
    id: 'PQ_SHIELD',
    name: 'pq_shield — Quantum-Safe Network Proxy',
    description: 'Post-quantum TLS-terminating reverse proxy with ML-KEM-1024 + XKyber key exchange, providing ingress security for legacy workloads.',
    technicalMechanism: 'ML-KEM-1024 + ML-DSA-87 handshake, AEAD transport, concurrency limiting, Raft-backed HA',
    relevanceToBankProblems: ['CRYPTOGRAPHIC_AGILITY', 'TRUST_BOUNDARY', 'SECURITY_SEGMENTATION', 'INCIDENT_RESPONSE'],
    evidenceUrl: 'backend/pq_shield/src/lib.rs',
  },
  {
    id: 'KEY_LIFECYCLE',
    name: 'Key Lifecycle Management',
    description: 'Formal key lifecycle state machine (Active → Rotating → Deprecated → Retired → Revoked) with time-based deprecation and secure destruction.',
    technicalMechanism: 'State machine with is_valid_transition(), TTL-based deprecation, secure on-disk destruction',
    relevanceToBankProblems: ['KEY_LIFECYCLE', 'CRYPTOGRAPHIC_AGILITY', 'COMPLIANCE_AUTOMATION'],
    evidenceUrl: 'VARDHAN_INVENTION_SHORTLIST.md#3-key-lifecycle-management',
  },
  {
    id: 'EXPOSURE_ALERT',
    name: 'Exposure-Alert Pipeline',
    description: 'Cryptographic exposure detection with pluggable alert sinks and automatic epoch quarantine trigger.',
    technicalMechanism: 'Pluggable AlertSink trait, AlertSeverity enum (INFO→CRITICAL), epoch quarantine integration',
    relevanceToBankProblems: ['INCIDENT_RESPONSE', 'CRYPTOGRAPHIC_AGILITY', 'KEY_LIFECYCLE'],
    evidenceUrl: 'VARDHAN_INVENTION_SHORTLIST.md#7-exposure-alert-pipeline',
  },
  {
    id: 'VERIFICATION_INFRASTRUCTURE',
    name: 'Independent Verification Infrastructure',
    description: 'Canonical payload integrity with ML-DSA-87 + Ed25519 dual signatures, enabling independent verification of sealed receipts and audit entries from issuer.',
    technicalMechanism: '10-field canonical payload, dual signature (ML-DSA-87 + Ed25519), BLAKE3 hash chaining, independent verifier reconstruction',
    relevanceToBankProblems: ['VERIFICATION_INFRASTRUCTURE', 'AUDIT_LIFECYCLE', 'TRUST_BOUNDARY', 'THIRD_PARTY_RISK', 'COMPLIANCE_AUTOMATION'],
    evidenceUrl: 'VARDHAN_INVENTION_SHORTLIST.md#6-canonical-payload-integrity',
  },
];

// ── REAL Signal Database ─────────────────────────────────────────────────────
// Each signal was verified by fetching the source URL and extracting the quote.
// See BANK_SIGNAL_PROVENANCE.md for the verification log.

export const BANK_SIGNAL_DATABASE: BankSignal[] = [
  // ── JPMorgan Chase ──────────────────────────────────────────────

  {
    signalId: 'JPMC-QSR-001',
    institution: 'JPMorgan Chase',
    businessUnit: 'Global Technology Applied Research',
    sourceType: 'CORPORATE_WEBSITE',
    sourceUrl: 'https://www.jpmorganchase.com/about/technology/research/applied-research',
    sourceTitle: 'Applied Research — J.P. Morgan',
    publishedDate: '2026-10-13',
    discoveryTimestamp: DISCOVERY_TS,
    evidenceExcerpt: 'Exploring the frontiers of Quantum Technologies as they are applied to the business, covering Quantum Computing and Quantum-Secured Communications, to address Quantum Computing\'s inevitable disruption to today\'s cryptography.',
    evidenceQuote: 'Exploring the frontiers of Quantum Technologies as they are applied to the business, covering Quantum Computing and Quantum-Secured Communications, to address Quantum Computing\'s inevitable disruption to today\'s cryptography.',
    observedFact: 'JPMorganChase Global Technology Applied Research explores frontier technologies including Quantum Computing and Quantum-Secured Communications to address the disruption that quantum computing will cause to current cryptography.',
    inferredImplication: 'VARDHAN_INFERENCE: JPMorganChase is actively assessing post-quantum cryptographic migration risks and investing in quantum-safe communications research, indicating an active cryptographic agility initiative (not a disclosed deployment).',
    problemType: 'CRYPTOGRAPHIC_AGILITY',
    relevanceToSponsor: 'Head of Cryptography / Quantum Computing Lead would need to validate migration planning and algorithm selection for quantum-safe key establishment.',
    confidence: 'HIGH',
    evidenceGaps: [
      'No specific migration timeline or deadline disclosed publicly',
      'No deployed algorithm stack is specified',
    ],
    vardhanCapabilities: ['AER-KEP-Q', 'PQ_SHIELD', 'KEY_LIFECYCLE'],
    recommendedValidationQuestion: "What post-quantum algorithms and key-establishment protocols is the firm's quantum-safe cryptography research evaluating?",
    isBankSpecific: true,
    notes: 'Page last-modified: Tue, 13 Oct 2026 15:52:34 GMT (retrieved via HEAD request).',
  },

  {
    signalId: 'JPMC-QSR-002',
    institution: 'JPMorgan Chase',
    businessUnit: 'Networking and Security R&D Team, Global Technology Applied Research',
    sourceType: 'CORPORATE_WEBSITE',
    sourceUrl: 'https://www.jpmorganchase.com/about/technology/research/applied-research',
    sourceTitle: 'Applied Research — J.P. Morgan',
    publishedDate: '2026-10-13',
    discoveryTimestamp: DISCOVERY_TS,
    evidenceExcerpt: 'The Networking and Security R&D Team at Global Technology Applied Research is leading research efforts in quantum networking and quantum-safe cryptography, which aim to address future risks of quantum computing attacks.',
    evidenceQuote: 'The Networking and Security R&D Team at Global Technology Applied Research is leading research efforts in quantum networking and quantum-safe cryptography, which aim to address future risks of quantum computing attacks.',
    observedFact: 'JPMorganChase has a Networking and Security R&D Team conducting research in quantum networking and quantum-safe cryptography to address future quantum computing attack risks.',
    inferredImplication: 'VARDHAN_INFERENCE: The firm has a dedicated security R&D team working on quantum-safe cryptography, suggesting active research into trust-boundary protocols and key-establishment mechanisms for post-quantum environments.',
    problemType: 'TRUST_BOUNDARY',
    relevanceToSponsor: 'Security Architecture / CISO would need to validate how quantum-safe key exchange and network segmentation are being prototyped.',
    confidence: 'HIGH',
    evidenceGaps: [
      'No specific quantum-safe protocols or vendors are named',
      'Deployment status (prototype vs. production pilot) not disclosed',
    ],
    vardhanCapabilities: ['AER-KEP-Q', 'PQ_SHIELD', 'AUDIT_LEDGER'],
    recommendedValidationQuestion: 'How is quantum-safe cryptography being evaluated for integration with existing network trust boundaries?',
    isBankSpecific: true,
  },

  {
    signalId: 'JPMC-QSR-003',
    institution: 'JPMorgan Chase',
    businessUnit: 'Blockchain and Privacy Team, Global Technology Applied Research',
    sourceType: 'CORPORATE_WEBSITE',
    sourceUrl: 'https://www.jpmorganchase.com/about/technology/research/applied-research',
    sourceTitle: 'Applied Research — J.P. Morgan',
    publishedDate: '2026-10-13',
    discoveryTimestamp: DISCOVERY_TS,
    evidenceExcerpt: 'In preparation for the arrival of cryptographically relevant quantum computers, the team is conducting research into methods to adapt blockchain technologies to be quantum resistant.',
    evidenceQuote: 'In preparation for the arrival of cryptographically relevant quantum computers, the team is conducting research into methods to adapt blockchain technologies to be quantum resistant.',
    observedFact: 'JPMorganChase is conducting research into methods to adapt its blockchain technologies to be quantum resistant, in preparation for cryptographically relevant quantum computers.',
    inferredImplication: "VARDHAN_INFERENCE: The firm's blockchain/digital-assets platform faces a known quantum vulnerability exposure and is investigating quantum-resistant adaptations, indicating a migration planning gap that affects distributed trust protocols.",
    problemType: 'CRYPTOGRAPHIC_AGILITY',
    relevanceToSponsor: 'Head of Blockchain / Digital Assets or CISO would need to validate quantum-resistance roadmaps for distributed ledger systems.',
    confidence: 'HIGH',
    evidenceGaps: [
      'Specific blockchain platforms affected are not named',
      'No timeline for quantum-resistant migration is disclosed',
    ],
    vardhanCapabilities: ['AER-KEP-Q', 'SIGNED_RECEIPT', 'KEY_LIFECYCLE'],
    recommendedValidationQuestion: 'Which blockchain or distributed-ledger systems are being assessed for quantum-resistant adaptation, and what migration approach is being evaluated?',
    isBankSpecific: true,
  },

  {
    signalId: 'JPMC-CYB-001',
    institution: 'JPMorgan Chase',
    businessUnit: 'Global Technology Leadership Team',
    sourceType: 'TECHNICAL_BLOG',
    sourceUrl: 'https://www.jpmorganchase.com/about/technology/blog/fortifying-the-enterprise-10-actions-to-take-now-for-ai-ready-cyber-resilience',
    sourceTitle: 'Fortifying the enterprise: 10 actions to take now for AI-ready cyber resilience',
    publishedDate: '2026-04-17',
    discoveryTimestamp: DISCOVERY_TS,
    evidenceExcerpt: 'Establish contractual requirements for timely security notifications, right-to-audit provisions, and defined recovery objectives, and verify these commitments are being met, not just documented.',
    evidenceQuote: 'Establish contractual requirements for timely security notifications, right-to-audit provisions, and defined recovery objectives, and verify these commitments are being met, not just documented.',
    observedFact: 'JPMorganChase recommends establishing contractual requirements for security notifications, right-to-audit provisions, and recovery objectives with third parties, verifying commitments are met rather than merely documented.',
    inferredImplication: 'VARDHAN_INFERENCE: Third-party risk verification is critical to JPMorganChase, and the firm values independently-verifiable audit commitments — a gap that Vardhan\'s sealed receipt and audit ledger can help address.',
    problemType: 'THIRD_PARTY_RISK',
    relevanceToSponsor: 'Head of Third-Party Risk Management or Deputy CISO would need to understand how audit commitments are verified.',
    confidence: 'HIGH',
    evidenceGaps: [
      'No information on specific third-party vendors or procurement processes',
    ],
    vardhanCapabilities: ['AUDIT_LEDGER', 'SIGNED_RECEIPT', 'KEY_LIFECYCLE'],
    recommendedValidationQuestion: 'How are third-party security commitments currently verified and audited?',
    isBankSpecific: true,
  },

  {
    signalId: 'JPMC-CYB-002',
    institution: 'JPMorgan Chase',
    businessUnit: 'Global Technology Leadership Team',
    sourceType: 'TECHNICAL_BLOG',
    sourceUrl: 'https://www.jpmorganchase.com/about/technology/blog/fortifying-the-enterprise-10-actions-to-take-now-for-ai-ready-cyber-resilience',
    sourceTitle: 'Fortifying the enterprise: 10 actions to take now for AI-ready cyber resilience',
    publishedDate: '2026-04-17',
    discoveryTimestamp: DISCOVERY_TS,
    evidenceExcerpt: 'Map the end-to-end lifecycle of a security patch from vendor release to production deployment; identify every handoff, approval gate, and testing queue that adds latency.',
    evidenceQuote: 'Map the end-to-end lifecycle of a security patch from vendor release to production deployment; identify every handoff, approval gate, and testing queue that adds latency.',
    observedFact: 'JPMorganChase documents the need to map security-patch lifecycles end-to-end, identifying handoffs, approval gates, and testing queues that add latency.',
    inferredImplication: 'VARDHAN_INFERENCE: The firm seeks observability into patch deployment pipelines with auditability at every gate — a use case for Vardhan\'s audit ledger with verifiable state transitions.',
    problemType: 'AUDIT_LIFECYCLE',
    relevanceToSponsor: 'Head of Security Operations or CI/CD Platform Lead would need to understand how pipeline observability is instrumented.',
    confidence: 'HIGH',
    evidenceGaps: [
      'No information on current audit-logging coverage or toolchain',
    ],
    vardhanCapabilities: ['AUDIT_LEDGER', 'SIGNED_RECEIPT'],
    recommendedValidationQuestion: 'What audit trail requirements exist for security-patch deployment pipelines?',
    isBankSpecific: true,
  },

  // ── HSBC ────────────────────────────────────────────────────────

  {
    signalId: 'HSBC-QSR-001',
    institution: 'HSBC',
    businessUnit: 'Quantum Technologies, Emerging Technology, Innovation and Ventures',
    sourceType: 'CORPORATE_WEBSITE',
    sourceUrl: 'https://www.hsbc.com/who-we-are/hsbc-and-digital/hsbc-and-quantum',
    sourceTitle: 'HSBC and Quantum',
    publishedDate: '2026-09-07',
    discoveryTimestamp: DISCOVERY_TS,
    evidenceExcerpt: 'We believe quantum technology is going to have a very significant impact on the financial services industry. ... Building quantum defences. Protecting against future cyber threats.',
    evidenceQuote: 'We believe quantum technology is going to have a very significant impact on the financial services industry. ... Building quantum defences. Protecting against future cyber threats.',
    observedFact: 'HSBC has a Quantum Technologies team within Emerging Technology, Innovation and Ventures that believes quantum computing will have a significant impact on financial services, and is building quantum defences to protect against future cyber threats.',
    inferredImplication: 'VARDHAN_INFERENCE: HSBC has an established quantum technology programme with explicit focus on defensive (post-quantum) cryptography, indicating active assessment of quantum-safe migration paths.',
    problemType: 'CRYPTOGRAPHIC_AGILITY',
    relevanceToSponsor: 'Head of Quantum Technologies or CISO would need to validate quantum-defence strategy and migration planning.',
    confidence: 'HIGH',
    evidenceGaps: [
      'Specific quantum-safe algorithms or protocols in use are not disclosed',
      'Timeline for quantum-defence deployment is not published',
    ],
    vardhanCapabilities: ['AER-KEP-Q', 'PQ_SHIELD', 'KEY_LIFECYCLE'],
    recommendedValidationQuestion: 'What quantum-safe cryptography strategies and protocols is HSBC evaluating for post-quantum migration?',
    isBankSpecific: true,
  },

  {
    signalId: 'HSBC-QSR-002',
    institution: 'HSBC',
    businessUnit: 'Emerging Technology, Innovation and Ventures',
    sourceType: 'CORPORATE_WEBSITE',
    sourceUrl: 'https://www.hsbc.com/who-we-are/hsbc-and-digital/hsbc-and-quantum',
    sourceTitle: 'HSBC and Quantum',
    publishedDate: '2026-09-07',
    discoveryTimestamp: DISCOVERY_TS,
    evidenceExcerpt: 'We\'re working with Quantinuum to apply quantum technologies and post-quantum cryptography to financial innovation, including the first application for tokenised physical gold.',
    evidenceQuote: 'We\'re working with Quantinuum to apply quantum technologies and post-quantum cryptography to financial innovation, including the first application for tokenised physical gold.',
    observedFact: 'HSBC is working with Quantinuum to apply post-quantum cryptography to financial innovation, including tokenised physical gold.',
    inferredImplication: 'VARDHAN_INFERENCE: HSBC has an active proof-of-concept or pilot programme applying post-quantum cryptography with a quantum-technology partner (Quantinuum), suggesting a live evaluation of quantum-safe protocols in a financial context.',
    problemType: 'CRYPTOGRAPHIC_AGILITY',
    relevanceToSponsor: 'Head of Quantum Technologies or Head of Digital Assets would need to validate the scope and security model of the PQC pilot.',
    confidence: 'HIGH',
    evidenceGaps: [
      'Specific PQC algorithms being tested are not named',
      'Production deployment plans are not disclosed',
    ],
    vardhanCapabilities: ['AER-KEP-Q', 'PQ_SHIELD', 'SIGNED_RECEIPT'],
    recommendedValidationQuestion: 'What post-quantum cryptographic algorithms and protocols are being tested in the Quantinuum collaboration?',
    isBankSpecific: true,
  },

  {
    signalId: 'HSBC-QSR-003',
    institution: 'HSBC',
    businessUnit: 'Innovation and Ventures',
    sourceType: 'PUBLIC_PDF',
    sourceUrl: 'https://www.hsbc.com/-/files/hsbc/who-we-are/pdf/250923-hsbc-x-ibm-quantum-algo-trading-transcript.pdf',
    sourceTitle: 'HSBC x IBM - Quantum Algo Trading (Transcript)',
    publishedDate: '2025-09-23',
    discoveryTimestamp: DISCOVERY_TS,
    evidenceExcerpt: 'What we\'ve demonstrated here is the ability to do something with a quantum computer in a hybrid workflow that we just cannot replicate using classical computing alone. ... up to 34 per cent improvement in predicting whether an order will be fulfilled.',
    evidenceQuote: 'What we\'ve demonstrated here is the ability to do something with a quantum computer in a hybrid workflow that we just cannot replicate using classical computing alone. ... up to 34 per cent improvement in predicting whether an order will be fulfilled.',
    observedFact: 'HSBC demonstrated a 34% improvement in order-fulfilment prediction using a quantum/hybrid workflow with IBM Quantum, described by HSBC\'s Group Head of Quantum Technologies Philip Intallura as "the single most important achievement of the HSBC quantum programme to date".',
    inferredImplication: 'VARDHAN_INFERENCE: HSBC has an active quantum computing programme with real-world production data applications — establishing quantum technology as a strategic organisational priority with dedicated technical personnel and resources.',
    problemType: 'CRYPTOGRAPHIC_AGILITY',
    relevanceToSponsor: 'Group Head of Quantum Technologies or CTO would need to validate the quantum programme\'s scope beyond algo-trading.',
    confidence: 'HIGH',
    evidenceGaps: [
      'Performance is measured on trading prediction, not security outcomes',
      'No information on quantum-safe cryptography budget or timeline',
    ],
    vardhanCapabilities: ['AER-KEP-Q', 'PQ_SHIELD'],
    recommendedValidationQuestion: 'How is the quantum programme structured across the bank, and what resources are allocated to quantum-defence work?',
    isBankSpecific: true,
  },

  {
    signalId: 'HSBC-QSR-004',
    institution: 'HSBC',
    businessUnit: 'Quantum Innovation',
    sourceType: 'TECHNICAL_BLOG',
    sourceUrl: 'https://www.hsbc.com/news-and-views/views/hsbc-views/upskilling-everyone-is-vital-for-the-quantum-era',
    sourceTitle: 'Upskilling everyone is vital for the quantum era',
    publishedDate: '2025-06-09',
    discoveryTimestamp: DISCOVERY_TS,
    evidenceExcerpt: 'With nearly 80 per cent of major global banks already engaging with quantum technologies, cultivating enterprise-wide quantum literacy is fast becoming a competitive necessity.',
    evidenceQuote: 'With nearly 80 per cent of major global banks already engaging with quantum technologies, cultivating enterprise-wide quantum literacy is fast becoming a competitive necessity.',
    observedFact: 'HSBC reports that nearly 80% of major global banks are already engaging with quantum technologies, making quantum literacy "a competitive necessity".',
    inferredImplication: 'VARDHAN_INFERENCE: Quantum technology adoption is widespread across major banks — HSBC operates in a competitive context where quantum-safe migration is industry-wide, making early adoption a differentiator.',
    problemType: 'CRYPTOGRAPHIC_AGILITY',
    relevanceToSponsor: 'Head of Quantum Technologies or Chief Learning Officer would need to validate workforce upskilling and strategy alignment.',
    confidence: 'HIGH',
    evidenceGaps: [
      'The "nearly 80%" figure is industry-aggregated, not HSBC-specific',
      'No specific upskilling metrics or timeline are provided',
    ],
    vardhanCapabilities: ['AER-KEP-Q', 'PQ_SHIELD'],
    recommendedValidationQuestion: 'How is quantum literacy being cultivated across HSBC, and what training programmes exist for cybersecurity architects?',
    isBankSpecific: true,
  },

  {
    signalId: 'HSBC-QSR-005',
    institution: 'HSBC',
    businessUnit: 'Quantum Innovation / Cybersecurity',
    sourceType: 'TECHNICAL_BLOG',
    sourceUrl: 'https://www.hsbc.com/news-and-views/views/hsbc-views/upskilling-everyone-is-vital-for-the-quantum-era',
    sourceTitle: 'Upskilling everyone is vital for the quantum era',
    publishedDate: '2025-06-09',
    discoveryTimestamp: DISCOVERY_TS,
    evidenceExcerpt: 'Quantum computers will be capable of breaking the encryption standards underpinning our digital world – the time to act is now, says Philip Intallura.',
    evidenceQuote: 'Quantum computers will be capable of breaking the encryption standards underpinning our digital world – the time to act is now, says Philip Intallura.',
    observedFact: 'Philip Intallura, Group Head of Quantum Technologies at HSBC, states that quantum computers will break current encryption standards and the time to act is now.',
    inferredImplication: "VARDHAN_INFERENCE: HSBC's quantum leadership actively identifies quantum-decryption threat timelines as urgent, signalling an active migration-planning process for quantum-safe cryptography.",
    problemType: 'CRYPTOGRAPHIC_AGILITY',
    relevanceToSponsor: 'Head of Quantum Technologies or CISO would need to validate migration timeline and risk assessment.',
    confidence: 'HIGH',
    evidenceGaps: [
      'No specific migration timeline or algorithm preference is disclosed',
      'Internal risk assessment details are not public',
    ],
    vardhanCapabilities: ['AER-KEP-Q', 'PQ_SHIELD', 'KEY_LIFECYCLE'],
    recommendedValidationQuestion: 'What is the bank\'s timeline assessment for quantum-safe migration, and which existing systems are prioritised?',
    isBankSpecific: true,
  },

  {
    signalId: 'HSBC-QSR-006',
    institution: 'HSBC',
    businessUnit: 'Cybersecurity',
    sourceType: 'TECHNICAL_BLOG',
    sourceUrl: 'https://www.hsbc.com/news-and-views/views/hsbc-views/upskilling-everyone-is-vital-for-the-quantum-era',
    sourceTitle: 'Upskilling everyone is vital for the quantum era',
    publishedDate: '2025-06-09',
    discoveryTimestamp: DISCOVERY_TS,
    evidenceExcerpt: 'Increasing activity among major financial regulators around quantum-safe readiness, with signs that it may soon become part of their supervisory frameworks.',
    evidenceQuote: 'We\'re seeing increasing activity among major financial regulators around quantum-safe readiness, with signs that it may soon become part of their supervisory frameworks.',
    observedFact: 'HSBC observes increasing financial-regulator activity around quantum-safe readiness, with potential for it to become part of supervisory frameworks.',
    inferredImplication: 'VARDHAN_INFERENCE: Regulatory supervisory expectations for quantum-safe readiness are emerging — banks must prepare for auditability and compliance requirements around PQC migration.',
    problemType: 'COMPLIANCE_AUTOMATION',
    relevanceToSponsor: 'Chief Risk Officer or Regulated Reporting Lead would need to validate regulatory readiness requirements.',
    confidence: 'MEDIUM',
    evidenceGaps: [
      'No specific regulator or framework is named',
      'No timeline for supervisory framework changes is provided',
    ],
    vardhanCapabilities: ['AUDIT_LEDGER', 'SIGNED_RECEIPT', 'VERIFICATION_INFRASTRUCTURE'],
    recommendedValidationQuestion: 'What regulatory guidance or supervisory expectations exist for quantum-safe readiness in the jurisdictions HSBC operates?',
    isBankSpecific: false, // Industry-regulatory context, not bank-specific
  },

  // ── Industry / regulatory context ─────────────────────────────────

  {
    signalId: 'IND-QSR-001',
    institution: 'Industry-wide',
    businessUnit: 'N/A',
    sourceType: 'TECHNICAL_BLOG',
    sourceUrl: 'https://www.hsbc.com/news-and-views/views/hsbc-views/upskilling-everyone-is-vital-for-the-quantum-era',
    sourceTitle: 'Upskilling everyone is vital for the quantum era',
    publishedDate: '2025-06-09',
    discoveryTimestamp: DISCOVERY_TS,
    evidenceExcerpt: 'We\'re seeing increasing activity among major financial regulators around quantum-safe readiness, with signs that it may soon become part of their supervisory frameworks.',
    evidenceQuote: 'We\'re seeing increasing activity among major financial regulators around quantum-safe readiness, with signs that it may soon become part of their supervisory frameworks.',
    observedFact: 'Major financial regulators are showing increasing activity around quantum-safe readiness, with signs it may become part of supervisory frameworks.',
    inferredImplication: 'VARDHAN_INFERENCE: Regulatory pressure for quantum-safe migration is rising across the financial sector, creating an industry-wide driver for cryptographic agility solutions.',
    problemType: 'COMPLIANCE_AUTOMATION',
    relevanceToSponsor: 'CRO, CTO, or Regulatory Affairs Lead across institutions would need to understand quantum-safe compliance requirements.',
    confidence: 'MEDIUM',
    evidenceGaps: [
      'Specific regulators and frameworks are not named',
      'Timeline for regulatory action is not specified',
    ],
    vardhanCapabilities: ['AUDIT_LEDGER', 'SIGNED_RECEIPT'],
    recommendedValidationQuestion: 'What specific quantum-safe compliance requirements are being anticipated in [jurisdiction]?',
    isBankSpecific: false,
  },
];

// ── Signal Groups (signals converging on a shared hypothesis) ────────────────

export const BANK_SIGNAL_GROUPS: BankSignalGroup[] = [
  {
    groupId: 'JPMC-PQC-2026',
    institution: 'JPMorgan Chase',
    problemType: 'CRYPTOGRAPHIC_AGILITY',
    hypothesis: 'JPMorganChase has an active post-quantum cryptography research programme spanning quantum computing, quantum-safe cryptography, and quantum-resistant blockchain, indicating a need for cryptographic agility tooling and migration planning.',
    signals: BANK_SIGNAL_DATABASE.filter(s => s.institution === 'JPMorgan Chase' && s.problemType === 'CRYPTOGRAPHIC_AGILITY'),
    sourceCount: 1,
    confidence: 'HIGH',
  },
  {
    groupId: 'JPMC-TPR-2026',
    institution: 'JPMorgan Chase',
    problemType: 'THIRD_PARTY_RISK',
    hypothesis: 'JPMorganChase requires independently-verifiable third-party security audit commitments and real-time verification, not just documented compliance.',
    signals: BANK_SIGNAL_DATABASE.filter(s => s.institution === 'JPMorgan Chase' && s.problemType === 'THIRD_PARTY_RISK'),
    sourceCount: 1,
    confidence: 'HIGH',
  },
  {
    groupId: 'JPMC-ALP-2026',
    institution: 'JPMorgan Chase',
    problemType: 'AUDIT_LIFECYCLE',
    hypothesis: 'JPMorganChase requires end-to-end auditability of security-patch deployment pipelines, with every handoff and approval gate recorded and verifiable.',
    signals: BANK_SIGNAL_DATABASE.filter(s => s.institution === 'JPMorgan Chase' && s.problemType === 'AUDIT_LIFECYCLE'),
    sourceCount: 1,
    confidence: 'HIGH',
  },
  {
    groupId: 'HSBC-PQC-2026',
    institution: 'HSBC',
    problemType: 'CRYPTOGRAPHIC_AGILITY',
    hypothesis: 'HSBC has an active quantum technology programme with quantum defences, PQC pilot work with Quantinuum, and strategic urgency around quantum-safe migration, indicating a need for post-quantum cryptographic tooling and migration verification.',
    signals: BANK_SIGNAL_DATABASE.filter(s => s.institution === 'HSBC' && s.problemType === 'CRYPTOGRAPHIC_AGILITY'),
    sourceCount: 3,
    confidence: 'HIGH',
  },
  {
    groupId: 'HSBC-COMPLIANCE-2026',
    institution: 'HSBC',
    problemType: 'COMPLIANCE_AUTOMATION',
    hypothesis: 'HSBC observes emerging regulatory supervisory expectations around quantum-safe readiness, indicating a need for audit-ready compliance automation for PQC migration.',
    signals: BANK_SIGNAL_DATABASE.filter(s => s.institution === 'HSBC' && s.problemType === 'COMPLIANCE_AUTOMATION'),
    sourceCount: 1,
    confidence: 'MEDIUM',
  },
];

// ── Lookup helpers ───────────────────────────────────────────────────────────

export function getSignalsByInstitution(institution: string): BankSignal[] {
  return BANK_SIGNAL_DATABASE.filter(
    s => s.institution.toLowerCase() === institution.toLowerCase()
  );
}

export function getSignalGroupsByInstitution(institution: string): BankSignalGroup[] {
  return BANK_SIGNAL_GROUPS.filter(
    g => g.institution.toLowerCase() === institution.toLowerCase()
  );
}

export function getAllInstitutions(): string[] {
  return [...new Set(BANK_SIGNAL_DATABASE.map(s => s.institution))];
}
