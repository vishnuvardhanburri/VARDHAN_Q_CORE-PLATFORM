/**
 * VARDHAN — Bank Signal Model
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Captures every discovered signal for a bank institution, enforcing the
 * information model required by the bank problem discovery engine:
 *
 *   - Institution and relevant business unit, when known
 *   - Original source URL and source type
 *   - Publication date and discovery timestamp
 *   - Exact supporting evidence / verbatim excerpt
 *   - Observed fact vs. inferred technical implication (never merged)
 *   - Potential cryptographic, post-quantum, governance or auditability problem
 *   - Confidence level and evidence gaps
 *   - Potential relevance to an existing Vardhan capability
 *   - Recommended validation question for a bank-side technical sponsor
 *
 * Design rules (enforced at construction):
 *   1. `observedFact` MUST be a direct quote or paraphrase from the public source.
 *   2. `inferredImplication` MUST be a VARDHAN_INFERENCE — it is clearly labelled
 *      and never presented as an observed fact.
 *   3. No private vulnerabilities, undisclosed incidents, deployed algorithms, or
 *      internal weaknesses may be inferred from insufficient public information.
 *   4. Missing evidence gaps MUST lower confidence, never inflate it.
 */

// ── Source provenance ────────────────────────────────────────────────────────

export type BankSourceType =
  | 'CORPORATE_WEBSITE'
  | 'TECHNICAL_BLOG'
  | 'ENGINEERING_PUBLICATION'
  | 'PRESS_RELEASE'
  | 'PUBLIC_PDF'
  | 'REGULATORY_STATEMENT';

// ── Problem categorisation ───────────────────────────────────────────────────

export type BankProblemType =
  | 'CRYPTOGRAPHIC_AGILITY'      // Active PQC / post-quantum transition
  | 'CRYPTOGRAPHIC_INVENTORY'    // Gaps in cryptographic asset discovery / inventory
  | 'TRUST_BOUNDARY'             // Cross-boundary trust verification & segmentation
  | 'AUDIT_LIFECYCLE'            // Immutable audit logging & compliance trail
  | 'KEY_LIFECYCLE'              // Key management, rotation, epoch state
  | 'INCIDENT_RESPONSE'          // Incident detection, quarantine, recovery
  | 'THIRD_PARTY_RISK'           // Supply-chain / third-party trust assessment
  | 'SECURITY_SEGMENTATION'      // Network/environment segmentation
  | 'COMPLIANCE_AUTOMATION'      // Regulatory compliance automation
  | 'VERIFICATION_INFRASTRUCTURE' // Independent verification & attestation
  | 'GENERAL_SECURITY_POSTURE';  // Generic security posture signal (low specificity)

// ── Confidence ───────────────────────────────────────────────────────────────

export type SignalConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

// ── Core signal record ───────────────────────────────────────────────────────

export interface BankSignal {
  /** Unique stable identifier, e.g. "JPMC-2026-QSR-001". */
  signalId: string;

  /** Institution name (canonical). */
  institution: string;

  /** Relevant business unit, team or division when known from the source. */
  businessUnit?: string;

  /** Type of public source. */
  sourceType: BankSourceType;

  /** Direct URL to the public source document / page. */
  sourceUrl: string;

  /** Title or headline of the source as it appears publicly. */
  sourceTitle: string;

  /** Publication date in ISO-8601 (YYYY-MM-DD). */
  publishedDate: string;

  /** When Vardhan discovered the signal (ISO-8601). */
  discoveryTimestamp: string;

  /** Verbatim excerpt from the public source (≤ 500 chars). */
  evidenceExcerpt: string;

  /** Exact supporting evidence or quote — may be same as excerpt, more precise. */
  evidenceQuote: string;

  /** What the source explicitly states (public fact). */
  observedFact: string;

  /** Vardhan's technical inference from the observed fact. NEVER presented as fact. */
  inferredImplication: string;

  /** The specific problem area this signal relates to. */
  problemType: BankProblemType;

  /** Why this signal is relevant to a bank-side technical sponsor. */
  relevanceToSponsor: string;

  /** Confidence in the signal's accuracy and relevance. */
  confidence: SignalConfidence;

  /** Evidence or context that is missing (lowers confidence when non-empty). */
  evidenceGaps: string[];

  /** Vardhan capabilities that map to this signal's problem type. */
  vardhanCapabilities: string[];

  /** Question a bank-side sponsor could answer to validate this signal. */
  recommendedValidationQuestion: string;

  /** Whether this signal was directly observed on a bank domain, or is industry context. */
  isBankSpecific: boolean;

  /** Additional notes (evidence gaps, assumptions, caveats). */
  notes?: string;
}

// ── Signal group (multiple signals converging on one problem) ───────────────

export interface BankSignalGroup {
  /** Group identifier, e.g. "JPMC-PQC-2026". */
  groupId: string;
  institution: string;
  problemType: BankProblemType;
  /** Why these signals are grouped (the shared hypothesis). */
  hypothesis: string;
  signals: BankSignal[];
  /** Number of distinct public sources backing the group. */
  sourceCount: number;
  /** Combined confidence (conservative — the minimum of member signals). */
  confidence: SignalConfidence;
}

// ── Vardhan capability registry (mirrors qcore_services) ─────────────────────

export interface VardhanCapability {
  id: string;
  name: string;
  description: string;
  technicalMechanism: string;
  relevanceToBankProblems: BankProblemType[];
  evidenceUrl?: string;
}

// ── Export a helper to build signals with provenance tracking ─────────────────

export type ObservationType = 'OBSERVED_FACT' | 'VARDHAN_INFERENCE';

export interface SignalProvenanceEntry {
  signalId: string;
  observation: ObservationType;
  claim: string;
  sourceUrls: string[];
  evidenceIds: string[];
}

export interface BankSignalProvenance {
  signalId: string;
  facts: string[];
  inferences: string[];
  assumptions: string[];
  sourceUrls: string[];
}
