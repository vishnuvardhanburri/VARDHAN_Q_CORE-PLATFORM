/**
 * VARDHAN — DEEP OWNER RESOLVER (additive)
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds the "owner graph": a responsibility link between the technical finding
 * (subsystem / topic) and an evidence-backed public person.
 *
 * It REUSES OwnerSelector (which in turn builds the evidence string that
 * IntelligenceEngine.identifyTechnicalOwner treats as explicit public listing).
 * The DeepOwner is a richer, provenance-preserving representation: it keeps the
 * verbatim candidate evidence, the responsibility match, and the confidence.
 */

import type { DeepOwner, OwnerConfidence, DeepStage } from './DeepTypes';
import type { OwnerCandidate, FindingClassification, Evidence } from './IntelligenceCase';
import { OwnerSelector } from './OwnerSelector';

/** Derive the responsibility area ("subsystem") from the finding + evidence. */
export function subsystemFromFinding(
  classification: FindingClassification | null,
  resolvedEvidence: Evidence[]
): string {
  const ft = classification?.finding_type || '';
  if (ft === 'OBSERVED_AVAILABILITY_ISSUE' || ft === 'REPEATED_ERRORS' || ft === 'OBSERVED_LATENCY') return 'availability & performance';
  if (ft === 'DOCUMENTED_INCIDENT') return 'reliability & observability';
  if (ft === 'DOCUMENTED_ENGINEERING_FAILURE') return 'reliability & observability';
  if (ft === 'POSSIBLE_PUBLIC_EXPOSURE' || ft === 'POSSIBLE_SENSITIVE_METADATA_EXPOSURE' || ft === 'POSSIBLE_INFORMATION_DISCLOSURE') return 'public API surface';
  if (ft === 'POSSIBLE_ACCESS_ISSUE') return 'security & auth';
  if (ft === 'DOCUMENTED_SECURITY_POSTURE') return 'security & compliance';
  if (resolvedEvidence.some(e => (e.sensitive_fields || []).some(f => /security|token|credential|key/i.test(f)))) return 'security & auth';
  if (ft === 'DOCUMENTED_SCALING_CONSTRAINT') return 'platform engineering';
  return 'platform engineering';
}

export class DeepOwnerResolver {
  static resolve(
    candidates: OwnerCandidate[],
    technicalArea: string,
    classification: FindingClassification | null,
    resolvedEvidence: Evidence[],
    onProgress?: (stage: DeepStage, message: string) => void
  ): DeepOwner | null {
    const sel = OwnerSelector.select(candidates, technicalArea);
    onProgress?.('owners', `Owner graph resolved: ${sel.candidate ? sel.candidate.name : '(no evidence-backed owner)'} — ${sel.reason}`);

    if (!sel.candidate) {
      return null;
    }

    const candidate = sel.candidate;
    // Part E: never synthesize or promote a LOW/MEDIUM identity to HIGH.
    // An owner is only "verified" when the candidate is explicitly HIGH
    // (real person + role + company context, on a people-context page).
    if (!candidate || candidate.confidence !== 'HIGH') {
      onProgress?.('owners', 'Owner graph: no verified HIGH-confidence person (NONE).');
      return null;
    }
    const responsibility = candidate.relationship_to_area || `Role '${candidate.role}' covers ${technicalArea}.`;
    const subsystem = subsystemFromFinding(classification, resolvedEvidence) || technicalArea || 'platform engineering';

    // Confidence is HIGH here: the gate above rejects anything that is not
    // explicitly HIGH. LOW/MEDIUM candidates never reach this point and are
    // never promoted.
    const confidence: string = 'HIGH';

    return {
      name: candidate.name,
      role: candidate.role,
      company: candidate.company,
      source_urls: candidate.source_urls,
      owner_evidence: candidate.evidence.length
        ? candidate.evidence
        : [DeepOwnerResolver.buildEvidenceString(candidate)],
      responsibility_match: responsibility,
      confidence,
      finding_link: subsystem
    };
  }

  /**
   * Build the canonical owner-evidence string in the EXACT format consumed
   * downstream as an explicit, evidence-backed public owner listing:
   *
   *   `<name> is listed as <role> on <url> — "<excerpt>"`
   *
   * The excerpt is a verbatim snippet taken from the candidate's public
   * evidence (empty string when the candidate carries no verbatim excerpt).
   * This never fabricates a role, name, or source — every field is taken
   * directly from the candidate record.
   */
  static buildEvidenceString(candidate: OwnerCandidate): string {
    const url = candidate.source_urls?.[0] || '';
    // Clean internal [BREAK] structural tokens from the verbatim excerpt so
    // the evidence string is readable (not a wall of [BREAK] markers).
    const rawExcerpt = candidate.evidence?.[0] || '';
    const excerpt = rawExcerpt
      .replace(/\s*\[BREAK\]\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return `${candidate.name} is listed as ${candidate.role} on ${url} — "${excerpt}"`;
  }
}
