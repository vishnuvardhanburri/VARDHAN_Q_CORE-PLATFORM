/**
 * VARDHAN — Bank Problem Dossier Generator
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Generates a 10-section bank problem dossier from a qualified opportunity.
 *
 * Each dossier clearly distinguishes:
 *   - ✓ PUBLIC FACT — directly stated in the public source
 *   - ⚠ TECHNICAL INFERENCE — Vardhan's analysis from the public fact
 *   - ✗ UNVERIFIED ASSUMPTION — plausible but not confirmed
 *
 * The dossier is a diagnostic hypothesis backed by public evidence — it does
 * NOT claim a problem exists internally or that the bank is interested in a
 * purchase. It proposes a bounded evaluation that a bank-side sponsor could
 * validate.
 */

import { BankSignal, BankSignalGroup, BankProblemType } from './BankSignalModel.ts';
import { QualifiedBankOpportunity } from './BankQualificationEngine.ts';
import { getSponsors } from './BankSponsorRoleMap.ts';
import { VARDHAN_CAPABILITIES } from './BankSignalDatabase.ts';

export interface BankProblemDossier {
  id: string;
  institution: string;
  businessArea: string;
  problemType: BankProblemType;
  generatedAt: string;
  gitHead: string;
  classification: string;

  // Section 1
  section1_institution: {
    name: string;
    jurisdiction: string;
    businessArea: string;
    website: string;
    evidence: { claim: string; sourceUrl: string; date: string }[];
  };

  // Section 2
  section2_verifiedEvidence: {
    excerpt: string;
    sourceUrl: string;
    sourceType: string;
    publishedDate: string;
    sourceTitle: string;
    provenance: string;
  }[];

  // Section 3
  section3_problemHypothesis: {
    hypothesis: string;
    observedFact: string;
    technicalInference: string;
    problemType: BankProblemType;
    supportingReasoning: string;
  };

  // Section 4
  section4_confidence: {
    level: 'HIGH' | 'MEDIUM' | 'LOW';
    rationale: string;
    unresolvedQuestions: string[];
    evidenceGaps: string[];
    scoreBreakdown: Record<string, number>;
    totalScore: number;
    scoreLabel: 'INTERNAL PRIORITIZATION SCORE';
    scoreNote: string;
    commercialReadiness: {
      total: number;
      label: string;
      buyingProcessEvidence: number;
      sponsorAccess: number;
      problemSpecificity: number;
    };
  };

  // Section 5
  section5_vardhanCapability: {
    capability: string;
    name: string;
    description: string;
    technicalMechanism: string;
    relevanceToProblem: string;
    evidenceUrl: string;
  }[];

  // Section 6
  section6_evaluationProposal: {
    title: string;
    scope: string;
    methodology: string;
    duration: string;
    estimatedCost: string;
    deliverables: string[];
    dataHandling: string;
  };

  // Section 7
  section7_successMetrics: {
    metric: string;
    acceptanceCriteria: string;
    baseline: string;
    measurementMethod: string;
  }[];

  // Section 8
  section8_sponsorRoles: {
    role: string;
    department: string;
    evidenceUrl: string;
    validationScope: string;
    confidence: string;
    notes?: string;
  }[];

  // Section 9
  section9_barriers: {
    category: string;
    description: string;
    evidence: string;
    mitigation: string;
  }[];

  // Section 10
  section10_nextAction: {
    action: string;
    rationale: string;
    gate: string;
    estimatedTimeline: string;
  };
}

/** Evaluation proposal templates per problem type. */
const EVALUATION_TEMPLATES: Record<BankProblemType, {
  scope: string;
  methodology: string;
  duration: string;
  estimatedCost: string;
  deliverables: string[];
}> = {
  CRYPTOGRAPHIC_AGILITY: {
    scope: 'Synthetic-data assessment of the institution\'s cryptographic inventory and quantum-vulnerability surface against Vardhan\'s AER-KEP-Q epoch management and pq_shield quantum-safe proxy.',
    methodology: 'Provide a synthetic cryptographic inventory dataset (100-500 entries) mirroring real asset metadata (algorithm class, key size, expiry, usage context). Run Vardhan\'s CryptographicInventoryDiscovery + QuantumVulnerabilityAssessor against the dataset. Map findings to the bank\'s stated quantum-safe cryptography research priorities.',
    duration: '5 working days',
    estimatedCost: '£15,000 (diagnostic) / £50,000 (proof-of-value)',
    deliverables: [
      'Cryptographic vulnerability assessment report (synthetic-data)',
      'AER-KEP-Q integration compatibility matrix',
      'pq_shield proxy deployment recommendation',
      'Migration risk prioritisation with bounded scope',
    ],
  },
  AUDIT_LIFECYCLE: {
    scope: 'Synthetic-data assessment of the institution\'s audit-logging pipeline against Vardhan\'s Audit Ledger with BLAKE3 hash chaining and ML-DSA-87 signing.',
    methodology: 'Provide a synthetic event log dataset (5,000-20,000 entries) mirroring security-patch deployment events. Run Vardhan\'s AuditLedgerValidator against the dataset. Demonstrate end-to-end verifiability and tamper-evidence.',
    duration: '5 working days',
    estimatedCost: '£15,000 (diagnostic) / £50,000 (proof-of-value)',
    deliverables: [
      'Audit ledger verifiability assessment report',
      'Tamper-evidence demonstration on synthetic data',
      'Integration points with existing SIEM/LMS',
      'Compliance mapping (SOX, FFIEC, ISO 20022)',
    ],
  },
  TRUST_BOUNDARY: {
    scope: 'Synthetic-data assessment of the institution\'s trust boundary verification against Vardhan\'s AER-KEP-Q and Signed Receipt contract.',
    methodology: 'Provide a synthetic trust-graph dataset (50-200 nodes) mirroring cross-boundary dependencies. Run Vardhan\'s TrustBoundaryVerifier and SignedReceiptGenerator. Demonstrate boundary-crossing attestation.',
    duration: '5 working days',
    estimatedCost: '£15,000 (diagnostic) / £50,000 (proof-of-value)',
    deliverables: [
      'Trust boundary assessment report',
      'Signed receipt verifiability demonstration',
      'Cross-boundary attestation model',
      'Segregation-of-duties gap analysis',
    ],
  },
  KEY_LIFECYCLE: {
    scope: 'Synthetic-data assessment of the institution\'s key lifecycle against Vardhan\'s Key Lifecycle Management state machine.',
    methodology: 'Provide a synthetic key inventory dataset (100-500 keys) mirroring key states, rotation schedules, and expiry. Run Vardhan\'s KeyLifecycleValidator. Demonstrate state-transition correctness and sunset detection.',
    duration: '5 working days',
    estimatedCost: '£15,000 (diagnostic) / £50,000 (proof-of-value)',
    deliverables: [
      'Key lifecycle state validation report',
      'Rotation scheduling recommendation',
      'State-transition verification report',
      'Secure destruction compliance checklist',
    ],
  },
  THIRD_PARTY_RISK: {
    scope: 'Synthetic-data assessment of the institution\'s third-party audit-commitment verification against Vardhan\'s Audit Ledger and Signed Receipt.',
    methodology: 'Provide a synthetic vendor-commitment dataset (20-100 vendors) mirroring SLA/security commitments. Run Vardhan\'s ThirdPartyTrustVerifier. Demonstrate independent attestation of meeting vs. documented compliance.',
    duration: '5 working days',
    estimatedCost: '£15,000 (diagnostic) / £50,000 (proof-of-value)',
    deliverables: [
      'Third-party commitment verification report',
      'Audit-commitment attestation model',
      'SLA verification demonstration on synthetic data',
      'Verification gaps vs. documented compliance',
    ],
  },
  COMPLIANCE_AUTOMATION: {
    scope: 'Synthetic-data assessment of the institution\'s compliance-automation pipeline against Vardhan\'s Audit Ledger with regulatory mapping.',
    methodology: 'Provide a synthetic compliance-event dataset (1,000-5,000 entries) mirroring regulatory audit markers. Run Vardhan\'s ComplianceAutomator. Demonstrate traceable compliance reporting.',
    duration: '5 working days',
    estimatedCost: '£15,000 (diagnostic) / £50,000 (proof-of-value)',
    deliverables: [
      'Compliance automation assessment report',
      'Regulatory mapping (quantum-safe readiness)',
      'Traceable audit trail demonstration',
      'Gap analysis vs. emerging supervisory expectations',
    ],
  },
  VERIFICATION_INFRASTRUCTURE: {
    scope: 'Synthetic-data assessment of the institution\'s verification infrastructure against Vardhan\'s Canonical Payload Integrity and independent verifier.',
    methodology: 'Provide a synthetic transaction dataset (500-2,000 transactions) mirroring receipt verification requirements. Run Vardhan\'s ReceiptVerifier. Demonstrate independent verification from issuer.',
    duration: '5 working days',
    estimatedCost: '£15,000 (diagnostic) / £50,000 (proof-of-value)',
    deliverables: [
      'Receipt verifiability assessment report',
      'Independent verifier demonstration',
      'Canonical payload reconstruction test',
      'ML-DSA-87 + Ed25519 dual-signature validation',
    ],
  },
  SECURITY_SEGMENTATION: {
    scope: 'Synthetic-data assessment of the institution\'s network/environment segmentation against Vardhan\'s trust-boundary analysis.',
    methodology: 'Provide a synthetic network-segment graph. Run Vardhan\'s SegmentationValidator. Demonstrate boundary-crossing detection.',
    duration: '5 working days',
    estimatedCost: '£15,000 (diagnostic) / £50,000 (proof-of-value)',
    deliverables: [
      'Segmentation validation report',
      'Boundary-crossing detection model',
      'Trust boundary mapping',
    ],
  },
  INCIDENT_RESPONSE: {
    scope: 'Synthetic-data assessment of the institution\'s incident-response pipeline against Vardhan\'s Exposure-Alert Pipeline.',
    methodology: 'Provide a synthetic alert dataset (100-500 alerts). Run Vardhan\'s AlertCorrelator. Demonstrate epoch quarantine on exposure detection.',
    duration: '5 working days',
    estimatedCost: '£15,000 (diagnostic) / £50,000 (proof-of-value)',
    deliverables: [
      'Incident-response pipeline assessment',
      'Alert correlation demonstration',
      'Epoch quarantine scenario test',
    ],
  },
  GENERAL_SECURITY_POSTURE: {
    scope: 'General security posture assessment using Vardhan Intelligence surface discovery.',
    methodology: 'Scan public surfaces of the institution\'s technology properties. Run Vardhan\'s DeepProspectBuilder in discovery mode. Report findings.',
    duration: '3 working days',
    estimatedCost: '£10,000 (diagnostic)',
    deliverables: [
      'Surface discovery report',
      'Security posture assessment',
      'Finding prioritisation',
    ],
  },
};

// ── Success metrics templates ───────────────────────────────────────────────

const METRICS_TEMPLATES: Record<BankProblemType, {
  metric: string;
  acceptanceCriteria: string;
  baseline: string;
  measurementMethod: string;
}[]> = {
  CRYPTOGRAPHIC_AGILITY: [
    {
      metric: 'Cryptographic vulnerability detection rate',
      acceptanceCriteria: '>80% of synthetic quantum-vulnerable assets identified with <10% false positive rate on the synthetic dataset',
      baseline: 'Unknown — diagnostic establishes baseline',
      measurementMethod: 'Run Vardhan CryptographicInventoryDiscovery against synthetic 500-entry key inventory',
    },
    {
      metric: 'AER-KEP-Q compatibility score',
      acceptanceCriteria: '>60% of synthetic key-establishment patterns match AER-KEP-Q epoch model',
      baseline: 'Unknown — pilot determines match',
      measurementMethod: 'Run Vardhan AER-KEP-Q simulator against synthetic handshake traces',
    },
  ],
  AUDIT_LIFECYCLE: [
    {
      metric: 'Audit log verifiability',
      acceptanceCriteria: '100% of synthetic audit entries reconstructable with valid BLAKE3 hash chain and ML-DSA-87 signature',
      baseline: 'Unknown — diagnostic establishes baseline',
      measurementMethod: 'Run Vardhan AuditLedgerValidator against synthetic 20,000-entry event log',
    },
    {
      metric: 'Tamper-evidence detection',
      acceptanceCriteria: '100% of injected tampering detected within 1 second',
      baseline: 'Unknown — diagnostic establishes baseline',
      measurementMethod: 'Inject 10 tampered entries into synthetic log; verify detection',
    },
  ],
  TRUST_BOUNDARY: [
    {
      metric: 'Trust boundary attestation rate',
      acceptanceCriteria: '>90% of synthetic boundary crossings produce verifiable signed receipts',
      baseline: 'Unknown — diagnostic establishes baseline',
      measurementMethod: 'Run Vardhan TrustBoundaryVerifier against synthetic 200-node trust graph',
    },
  ],
  KEY_LIFECYCLE: [
    {
      metric: 'Key lifecycle state accuracy',
      acceptanceCriteria: '>95% of synthetic keys correctly classified as Active/Rotating/Deprecated/Retired/Revoked',
      baseline: 'Unknown — diagnostic establishes baseline',
      measurementMethod: 'Run Vardhan KeyLifecycleValidator against synthetic 500-key inventory',
    },
  ],
  THIRD_PARTY_RISK: [
    {
      metric: 'Third-party commitment verification rate',
      acceptanceCriteria: '>85% of synthetic vendor commitments independently verifiable via signed receipts',
      baseline: 'Unknown — diagnostic establishes baseline',
      measurementMethod: 'Run Vardhan ThirdPartyTrustVerifier against synthetic 100-vendor dataset',
    },
  ],
  COMPLIANCE_AUTOMATION: [
    {
      metric: 'Compliance traceability',
      acceptanceCriteria: '100% of synthetic compliance markers traceable to signed audit entries',
      baseline: 'Unknown — diagnostic establishes baseline',
      measurementMethod: 'Run Vardhan ComplianceAutomator against synthetic 5,000-entry compliance dataset',
    },
  ],
  VERIFICATION_INFRASTRUCTURE: [
    {
      metric: 'Receipt verifiability rate',
      acceptanceCriteria: '>95% of synthetic receipts independently verifiable',
      baseline: 'Unknown — diagnostic establishes baseline',
      measurementMethod: 'Run Vardhan ReceiptVerifier against synthetic 2,000-transaction dataset',
    },
  ],
  SECURITY_SEGMENTATION: [
    {
      metric: 'Boundary-crossing detection rate',
      acceptanceCriteria: '>90% of unauthorized boundary crossings detected',
      baseline: 'Unknown — diagnostic establishes baseline',
      measurementMethod: 'Run Vardhan SegmentationValidator against synthetic network graph',
    },
  ],
  INCIDENT_RESPONSE: [
    {
      metric: 'Alert correlation accuracy',
      acceptanceCriteria: '>80% of correlated alerts correctly identified as related incidents',
      baseline: 'Unknown — diagnostic establishes baseline',
      measurementMethod: 'Run Vardhan AlertCorrelator against synthetic 500-alert dataset',
    },
  ],
  GENERAL_SECURITY_POSTURE: [
    {
      metric: 'Surface discovery completeness',
      acceptanceCriteria: '>70% of public technology surfaces identified',
      baseline: 'Unknown — diagnostic establishes baseline',
      measurementMethod: 'Run Vardhan DeepProspectBuilder against institution domain',
    },
  ],
};

// ── Barriers by problem type ─────────────────────────────────────────────────

const BARRIERS_TEMPLATES: Record<BankProblemType, {
  category: string;
  description: string;
  evidence: string;
  mitigation: string;
}[]> = {
  CRYPTOGRAPHIC_AGILITY: [
    {
      category: 'Procurement',
      description: 'Large banks operate multi-year procurement cycles with extensive tender and approval processes for security infrastructure.',
      evidence: 'JPMorgan Chase technology page describes enterprise-scale security operations with formal procurement processes.',
      mitigation: 'Frame as a diagnostic assessment (£15K) with no procurement commitment, allowing entry before formal RFP cycle.',
    },
    {
      category: 'Security Assurance',
      description: 'Banks require extensive third-party security assessments (SOC 2, ISO 27001, penetration testing) before integrating new infrastructure.',
      evidence: 'JPMorgan Chase blog recommends "contractual requirements for timely security notifications, right-to-audit provisions".',
      mitigation: 'Provide Vardhan security package (attestation, audit ledger export) as part of diagnostic deliverable.',
    },
    {
      category: 'Integration',
      description: 'Post-quantum migration requires integration with existing key management, HSM, and PKI infrastructure.',
      evidence: 'JPMorgan Chase research mentions adapting blockchain technologies; HSBC mentions quantum key distribution.',
      mitigation: 'Design pq_shield as a reverse proxy with no upstream changes — zero integration risk for proof-of-value.',
    },
  ],
  AUDIT_LIFECYCLE: [
    {
      category: 'Security Assurance',
      description: 'Audit infrastructure must meet regulatory compliance requirements (SOX, FFIEC, BCBS 239).',
      evidence: 'Industries/banking/plane.json lists SOX, FFIEC, BCBS 239, ISO 20022 as compliance requirements.',
      mitigation: 'Diagnostic uses synthetic data only — no production audit data exposure.',
    },
    {
      category: 'Integration',
      description: 'Existing SIEM, LMS, and monitoring stacks may require adapter layers.',
      evidence: 'JPMorgan Chase mentions correlating vulnerability data with asset criticality and reachability.',
      mitigation: 'Diagnostic demonstrates export to syslog/SIEM format as a deliverable.',
    },
  ],
  TRUST_BOUNDARY: [
    {
      category: 'Integration',
      description: 'Trust boundary solutions must integrate with existing IAM and authorization systems.',
      evidence: 'Industries/banking/plane.json lists IAM and privilege_access as integrations.',
      mitigation: 'Diagnostic assesses compatibility via synthetic trust-graph without production IAM access.',
    },
  ],
  KEY_LIFECYCLE: [
    {
      category: 'Security Assurance',
      description: 'Key management requires HSM integration and compliance with banking security standards.',
      evidence: 'Industries/banking/plane.json lists hsm_key_protection as a control.',
      mitigation: 'Diagnostic operates on synthetic key inventory; no real HSM or production keys involved.',
    },
  ],
  THIRD_PARTY_RISK: [
    {
      category: 'Procurement',
      description: 'Third-party risk vendors are typically selected via centralised procurement processes.',
      evidence: 'JPMorgan Chase blog mentions contractual requirements and approval gates in patch lifecycle.',
      mitigation: 'Frame as advisory diagnostic, not a vendor replacement.',
    },
  ],
  COMPLIANCE_AUTOMATION: [
    {
      category: 'Regulatory',
      description: 'Compliance automation must map to jurisdiction-specific regulatory frameworks.',
      evidence: 'HSBC article notes regulators are increasing activity around quantum-safe readiness.',
      mitigation: 'Diagnostic produces compliance-mapping report aligned to bank\'s jurisdiction.',
    },
  ],
  VERIFICATION_INFRASTRUCTURE: [
    {
      category: 'Integration',
      description: 'Independent verification infrastructure must integrate with existing signing and verification pipelines.',
      evidence: 'JPMorgan Chase mentions verifying commitments are met, not just documented.',
      mitigation: 'Diagnostic demonstrates verification on synthetic receipts only.',
    },
  ],
  SECURITY_SEGMENTATION: [
    {
      category: 'Integration',
      description: 'Segmentation enforcement must align with existing network infrastructure.',
      evidence: 'JPMorgan Chase blog recommends "segment your end-user environment" and "restrict access to specific, approved endpoints".',
      mitigation: 'Diagnostic provides assessment without modifying existing network policies.',
    },
  ],
  INCIDENT_RESPONSE: [
    {
      category: 'Integration',
      description: 'Incident response pipelines must integrate with existing SOAR/SIEM platforms.',
      evidence: 'Industries/banking/plane.json lists siem and itsm as integrations.',
      mitigation: 'Diagnostic demonstrates alert correlation via synthetic data, no SOAR integration required.',
    },
  ],
  GENERAL_SECURITY_POSTURE: [
    {
      category: 'Procurement',
      description: 'General platform assessments typically require formal procurement processes.',
      evidence: 'Large banks have standardised procurement workflows.',
      mitigation: 'Frame as diagnostic, not a platform purchase.',
    },
  ],
};

// ── Main generator ──────────────────────────────────────────────────────────

export class BankProblemDossierGenerator {
  /** Generate a complete 10-section dossier from a qualified opportunity + signal group. */
  static generate(
    opportunity: QualifiedBankOpportunity,
    group: BankSignalGroup,
    options?: {
      gitHead?: string;
    }
  ): BankProblemDossier {
    const sponsorMap = getSponsors(opportunity.institution);
    const evalTemplate = EVALUATION_TEMPLATES[opportunity.problemType] || EVALUATION_TEMPLATES.GENERAL_SECURITY_POSTURE;
    const metrics = METRICS_TEMPLATES[opportunity.problemType] || METRICS_TEMPLATES.GENERAL_SECURITY_POSTURE;
    const barriers = BARRIERS_TEMPLATES[opportunity.problemType] || BARRIERS_TEMPLATES.GENERAL_SECURITY_POSTURE;

    // Collect all signal data
    const signals = group.signals;
    const evidence = signals.map(s => ({
      excerpt: s.evidenceExcerpt,
      sourceUrl: s.sourceUrl,
      sourceType: s.sourceType,
      publishedDate: s.publishedDate,
      sourceTitle: s.sourceTitle,
      provenance: s.isBankSpecific ? 'DOCUMENTED_FACT (bank-specific)' : 'DOCUMENTED_FACT (industry context)',
    }));

    // Section 5: Vardhan capabilities
    const vardhanCaps = opportunity.vardhanCapabilities
      .map(id => VARDHAN_CAPABILITIES.find(c => c.id === id))
      .filter(Boolean) as typeof VARDHAN_CAPABILITIES;

    const primaryObservedFact = signals[0]?.observedFact || group.hypothesis;
    const primaryInference = signals[0]?.inferredImplication || '';

    return {
      id: `DOSSIER-${opportunity.institution.replace(/\s+/g, '')}-${opportunity.problemType}-${new Date().getFullYear()}`,
      institution: opportunity.institution,
      businessArea: opportunity.businessArea,
      problemType: opportunity.problemType,
      generatedAt: new Date().toISOString(),
      gitHead: options?.gitHead || 'unknown',
      classification: 'AUTHORIZATION_REQUIRED — Internal Vardhan Intelligence Use Only',

      // Section 1: Institution and relevant business area
      section1_institution: {
        name: opportunity.institution,
        jurisdiction: sponsorMap?.jurisdiction || 'Unknown',
        businessArea: group.hypothesis,
        website: sponsorMap?.website || 'Unknown',
        evidence: signals
          .filter(s => s.isBankSpecific)
          .map(s => ({
            claim: `${s.businessUnit || 'N/A'}: ${s.observedFact}`,
            sourceUrl: s.sourceUrl,
            date: s.publishedDate,
          })),
      },

      // Section 2: Verified public evidence with source links and dates
      section2_verifiedEvidence: evidence,

      // Section 3: Problem hypothesis and supporting reasoning
      section3_problemHypothesis: {
        hypothesis: group.hypothesis,
        observedFact: primaryObservedFact,
        technicalInference: primaryInference,
        problemType: opportunity.problemType,
        supportingReasoning: this._buildReasoning(signals),
      },

      // Section 4: Confidence and unresolved questions
      section4_confidence: {
        level: opportunity.confidence,
        rationale: this._confidenceRationale(opportunity, signals),
        unresolvedQuestions: opportunity.unresolvedQuestions,
        evidenceGaps: opportunity.evidenceGaps,
        scoreBreakdown: opportunity.scoreBreakdown,
        totalScore: opportunity.totalScore,
        scoreLabel: 'INTERNAL PRIORITIZATION SCORE',
        scoreNote: `This score measures evidence of a disclosed initiative with a technically-addressable problem. It does NOT indicate commercial readiness or buying intent. See commercialReadiness below.`,
        commercialReadiness: {
          total: opportunity.commercialReadiness.total,
          label: opportunity.commercialReadiness.label,
          buyingProcessEvidence: opportunity.commercialReadiness.buyingProcessEvidence,
          sponsorAccess: opportunity.commercialReadiness.sponsorAccess,
          problemSpecificity: opportunity.commercialReadiness.problemSpecificity,
        },
      },

      // Section 5: Vardhan capability that may address the problem
      section5_vardhanCapability: vardhanCaps.map(cap => ({
        capability: cap.id,
        name: cap.name,
        description: cap.description,
        technicalMechanism: cap.technicalMechanism,
        relevanceToProblem: `Relevant to ${cap.relevanceToBankProblems.join(', ')}`,
        evidenceUrl: cap.evidenceUrl,
      })),

      // Section 6: Bounded synthetic-data evaluation proposal
      section6_evaluationProposal: {
        title: `[Diagnostic] ${opportunity.institution} — ${opportunity.problemType} assessment using synthetic data`,
        ...evalTemplate,
        dataHandling: 'All evaluation data is synthetic — no production bank data, credentials, or customer information are used. All evidence is derived from public sources only.',
      },

      // Section 7: Proposed success metrics and acceptance criteria
      section7_successMetrics: metrics,

      // Section 8: Likely technical sponsor and budget-owner roles
      section8_sponsorRoles: sponsorMap?.sponsorRoles.map(s => ({
        role: s.role,
        department: s.department,
        evidenceUrl: s.evidenceUrl,
        validationScope: s.validationScope,
        confidence: s.confidence,
        notes: s.notes,
      })) || [],

      // Section 9: Procurement, security assurance and integration barriers
      section9_barriers: barriers,

      // Section 10: Recommended next action
      section10_nextAction: {
        action: 'Hold for human approval — do not initiate outbound contact.',
        rationale: `Opportunity scored ${opportunity.totalScore}/100 (${opportunity.priority}). ${opportunity.status === 'READY_FOR_HUMAN_APPROVAL' ? 'Meets qualification threshold but requires human review before any external outreach.' : 'Below qualification threshold — blocked.'}`,
        gate: 'HUMAN_APPROVAL_REQUIRED',
        estimatedTimeline: 'Within 2 business days of human approval',
      },
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private static _buildReasoning(signals: BankSignal[]): string {
    const facts = signals.map(s => s.observedFact);
    const inferences = signals.map(s => s.inferredImplication);

    return `Observed facts:\n` +
      facts.map((f, i) => `  ${i + 1}. ${f}`).join('\n') +
      `\n\nTechnical inferences (VARDHAN_INFERENCE — not observed facts):\n` +
      inferences.map((inf, i) => `  ${i + 1}. ${inf}`).join('\n') +
      `\n\nThese facts and inferences converge on the hypothesis that the institution has an active initiative in the relevant problem domain.`;
  }

  private static _confidenceRationale(opp: QualifiedBankOpportunity, signals: BankSignal[]): string {
    const parts: string[] = [];
    if (signals.length >= 2) {
      parts.push(`Multiple credible signals (${signals.length}) from ${new Set(signals.map(s => s.sourceUrl)).size} distinct public sources.`);
    }
    if (signals.some(s => s.sourceType === 'CORPORATE_WEBSITE')) {
      parts.push('Signals from the bank\'s own corporate website (institution-specific).');
    }
    if (signals.some(s => s.sourceType === 'TECHNICAL_BLOG')) {
      parts.push('Signals from the bank\'s own technical/engineering blog (authoritative source).');
    }
    const gaps = [...new Set(signals.flatMap(s => s.evidenceGaps))];
    if (gaps.length > 0) {
      parts.push(`Evidence gaps remain: ${gaps.slice(0, 3).join('; ')}.`);
    }
    parts.push(`Internal prioritization score: ${opp.totalScore}/100 (${opp.priority} tier).`);
    parts.push(`Commercial readiness: ${opp.commercialReadiness.label} (${opp.commercialReadiness.total}/100) — NOT ASSESSED unless buying-process evidence exists.`);
    return parts.join(' ');
  }
}
