/**
 * VARDHAN — OWNER PIPELINE
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates the transition from "Collect-then-Filter" to "Plan-then-Hunt".
 * 
 * Flow:
 * Opportunity -> OwnerSearchPlanner -> TargetedDiscoveryEngine -> 
 * OwnershipInferenceEngine -> DeepOwnerResolver
 */

import { OwnerSearchPlanner } from './OwnerSearchPlanner';
import { TargetedDiscoveryEngine } from './TargetedDiscoveryEngine';
import { OwnershipInferenceEngine } from './OwnershipInferenceEngine';
import { PeopleExtractor } from './PeopleExtractor';
import { LiveWebResearchProvider } from './LiveWebResearchProvider';
import { OwnerSelector } from './OwnerSelector';
import { DeepOwnerResolver, subsystemFromFinding } from './DeepOwnerResolver';
import { CANDIDATE_ROLES } from './IntelligenceCase';
import type { 
  FindingClassification, Evidence, OwnerCandidate
} from './IntelligenceCase';
import type { 
  OwnerResolutionResult, DeepOwner, OwnerSearchPlan,
  OwnerProvenance, ProviderCompanyLike, GrowjoCompany, EvidenceLedger, DeepStage
} from './DeepTypes';
import { GrowjoProvider } from './GrowjoProvider';

const ROLE_KEYWORDS = [
  ...CANDIDATE_ROLES.map((r: string) => r.toLowerCase()),
  'cto', 'chief technology officer', 'vp engineering', 'vp of engineering',
  'vp platform', 'director of engineering', 'director of platform',
  'head of engineering', 'head of platform', 'head of infrastructure',
  'platform engineering lead', 'infrastructure lead', 'sre', 'security',
  'developer platform', 'engineering manager', 'staff engineer',
  'principal engineer', 'technical founder', 'co-founder', 'co founder',
  'backend', 'devops', 'infrastructure', 'platform', 'reliability',
];

function canonicalName(name: string): string {
  return (name || '').toLowerCase().replace(/\s+/g, '').replace(/^['"]+|['"]+$/g, '');
}

function domainMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (d: string) => d.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').replace(/:\d+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

function isTechnicalRole(title: string | null | undefined): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return ROLE_KEYWORDS.some(k => t.includes(k));
}

function companyIdentityMatch(growjoCompany: string | null | undefined, targetCompany: string): boolean {
  if (!growjoCompany) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\s*(inc|llc|ltd|co\.?)\s*$/i, '').replace(/\s+/g, ' ').trim();
  const a = norm(growjoCompany);
  const b = norm(targetCompany);
  return a.includes(b) || b.includes(a);
}

/** Merge provider-derived candidates with public-page candidates. */
function mergeProviderAndPublic(
  providerCandidates: OwnerCandidate[],
  publicCandidates: OwnerCandidate[],
  onProgress?: (stage: string, message: string) => void,
): OwnerCandidate[] {
  const merged: OwnerCandidate[] = [];
  const byName = new Map<string, number>();

  for (const c of providerCandidates) {
    const key = canonicalName(c.name);
    const idx = byName.get(key);
    if (idx !== undefined) {
      const existing = merged[idx];
      existing.evidence = Array.from(new Set([...existing.evidence, ...c.evidence]));
      existing.source_urls = Array.from(new Set([...existing.source_urls, ...c.source_urls]));
      existing.explicit_evidence = existing.explicit_evidence || c.explicit_evidence;
      onProgress?.('people', `  [dedupe] ${existing.name} — merged candidate from multiple provider sources.`);
    } else {
      byName.set(key, merged.length);
      merged.push(c);
    }
  }

  for (const pub of publicCandidates) {
    const idx = byName.get(canonicalName(pub.name));
    if (idx !== undefined) {
      const existing = merged[idx];
      existing.evidence = Array.from(new Set([...existing.evidence, ...pub.evidence]));
      existing.source_urls = Array.from(new Set([...existing.source_urls, ...pub.source_urls]));
      existing.explicit_evidence = existing.explicit_evidence || pub.explicit_evidence;
      onProgress?.('people', `  [corroborate] ${existing.name} — public listing corroborates provider identity.`);
    } else {
      byName.set(canonicalName(pub.name), merged.length);
      merged.push(pub);
    }
  }
  return merged;
}

/** Build a single provider-derived candidate with full filtering. */
function buildProviderCandidate(
  data: ProviderCompanyLike,
  technicalArea: string,
  targetDomain: string | null,
  targetCompany: string,
  evidenceTag: string,
  onProgress?: (stage: string, message: string) => void,
): OwnerCandidate | null {
  const p = { name: data.primary_person_name, title: data.primary_title };
  const label = data.source || 'provider';
  if (!p.name) {
    onProgress?.('people', `  [${label}] no person name in record (not an owner candidate).`);
    return null;
  }
  if (!isTechnicalRole(p.title)) {
    onProgress?.('people', `  [${label}] ${p.name} — skipped (role "${p.title || ''}" is not a technical owner role; not a candidate).`);
    return null;
  }
  const domainOk = domainMatch(data.domain, targetDomain) || domainMatch(data.domain, targetDomain);
  const companyOk = domainOk || companyIdentityMatch(data.company, targetCompany);
  if (!companyOk) {
    onProgress?.('people', `  [${label}] ${p.name} — skipped (company identity mismatch; not a candidate, not invented).`);
    return null;
  }
  const src = data.growjo_url || data.source_url || '';
  const evidence = `${evidenceTag}: ${p.name} is listed as ${p.title} on ${src || `(${label} record)`}`;
  onProgress?.('people', `  [${label}] ${p.name} — ${p.title} (HIGH, ${evidenceTag})`);
  return {
    name: p.name,
    role: p.title || 'Technical role',
    company: data.company || targetCompany,
    source_urls: src ? [src] : [],
    evidence: [evidence],
    relationship_to_area: `Role '${p.title}' covers ${technicalArea}.`,
    confidence: 'HIGH',
    explicit_evidence: true,
  };
}

/** Input shape for the static OwnerPipeline.resolve (backward compatibility). */
export interface OwnerPipelineInput {
  company: string;
  targetDomain: string;
  technicalArea?: string;
  classification: FindingClassification | null;
  resolvedEvidence: Evidence[];
  growjoData: GrowjoCompany | null;
  providerCompanies?: ProviderCompanyLike[] | null;
  publicCandidates: OwnerCandidate[];
  onProgress?: (stage: string, message: string) => void;
}

/** Result shape for the static OwnerPipeline.resolve (backward compatibility). */
export interface OwnerPipelineResult {
  candidates: OwnerCandidate[];
  selected: DeepOwner | null;
  selectedCandidate: OwnerCandidate | null;
  ownerEvidenceString: string;
  reason: string;
  provenance: OwnerProvenance;
}

export class OwnerPipeline {
  constructor(
    private researchProvider: LiveWebResearchProvider,
    private peopleExtractor: PeopleExtractor
  ) {}

  async resolve(
    opportunityId: string,
    classification: FindingClassification | null,
    evidence: Evidence[]
  ): Promise<OwnerResolutionResult> {
    const plan: OwnerSearchPlan = OwnerSearchPlanner.plan(
      opportunityId, 
      classification, 
      evidence
    );

    const discoveryEngine = new TargetedDiscoveryEngine(
      this.researchProvider, 
      this.peopleExtractor
    );
    const ledger: EvidenceLedger = await discoveryEngine.hunt(plan);

    const candidates = this.aggregateCandidates(ledger);
    const scoredCandidates = candidates.map(c => {
      const { score, dimensions } = OwnershipInferenceEngine.scoreCandidate(c, ledger, plan);
      return {
        candidate: c,
        score,
        dimensions
      };
    });

    return this.finalizeResolution(opportunityId, scoredCandidates, ledger);
  }

  private aggregateCandidates(ledger: EvidenceLedger): any[] {
    const registry = new Map<string, any>();
    for (const claim of ledger.claims) {
      const parts = claim.claim.split(' is a ');
      if (parts.length < 2) continue;
      const name = parts[0];
      const role = parts[1];
      const existing = registry.get(name);
      if (!existing) {
        registry.set(name, {
          name,
          role,
          company: 'Unknown',
          source_urls: [claim.source_url],
          owner_evidence: [claim.claim]
        });
      } else {
        existing.source_urls.push(claim.source_url);
        existing.owner_evidence.push(claim.claim);
      }
    }
    return Array.from(registry.values());
  }

  private finalizeResolution(
    opportunityId: string, 
    scored: any[], 
    ledger: EvidenceLedger
  ): OwnerResolutionResult {
    const sorted = scored.sort((a, b) => b.score - a.score);
    const primary = sorted[0];

    if (!primary) {
      return {
        opportunity_id: opportunityId,
        candidates: [],
        primary_candidate: null,
        identity_confidence: 0,
        role_confidence: 0,
        technical_relevance: 0,
        ownership_confidence: 0,
        contactability_confidence: 0,
        evidence_ids: [],
        source_urls: [],
        verification_state: 'NO_OWNER_FOUND',
        next_action: 'RESEARCH_MORE'
      };
    }

    const candidate = primary.candidate;
    const isContactable = this.verifyLegitimateContact(candidate);
    const confidence = OwnershipInferenceEngine.resolveConfidence(
      primary.score, 
      isContactable
    );

    // STRICT STATE-TRANSITION GATE
    let nextAction: 'OUTREACH_CANDIDATE' | 'RESEARCH_MORE' = 'RESEARCH_MORE';

    if (confidence === 'OWNER_VERIFIED_CONTACTABLE') {
      nextAction = 'OUTREACH_CANDIDATE';
    } else if (confidence === 'OWNER_HIGH_CONFIDENCE' && isContactable) {
      // In a real system, this might trigger a separate verification step, 
      // but based on requirements, we only promote VERIFIED_CONTACTABLE to outreach.
      nextAction = 'RESEARCH_MORE'; 
    } else {
      nextAction = 'RESEARCH_MORE';
    }

    return {
      opportunity_id: opportunityId,
      candidates: sorted.map(s => ({
        ...s.candidate,
        confidence: confidence
      })),
      primary_candidate: {
        ...candidate,
        confidence: confidence
      },
      identity_confidence: primary.dimensions.IDENTITY,
      role_confidence: primary.dimensions.ROLE,
      technical_relevance: primary.dimensions.TECHNICAL_RELEVANCE,
      ownership_confidence: primary.dimensions.OWNERSHIP,
      contactability_confidence: primary.dimensions.CONTACTABILITY,
      evidence_ids: ledger.claims.map(c => c.evidence_id),
      source_urls: candidate.source_urls,
      verification_state: confidence,
      next_action: nextAction
    };
  }

  private verifyLegitimateContact(candidate: any): boolean {
    // A legitimate contact is one that has a verifiable public professional
    // contact method. We accept public emails OR professional profile links.
    if (!candidate) return false;
    const email = candidate.email?.toLowerCase?.() || '';
    if (email && !email.includes('example.com') && !email.includes('test@')) return true;
    if (candidate.linkedin_url || candidate.public_profile_url) return true;
    // No verified contact — still allow owner resolution but at lower confidence
    return false;
  }

  // ── STATIC (backward-compatible) resolve ─────────────────────────────────
  // Accepts the legacy OwnerPipelineInput shape and returns an OwnerPipelineResult.
  // This preserves the API expected by personDiscovery.test.ts and other static
  // callers. Internally delegates to OwnerSelector + DeepOwnerResolver.
  static resolve(input: OwnerPipelineInput): OwnerPipelineResult {
    const {
      company, targetDomain, technicalArea, classification, resolvedEvidence,
      growjoData, providerCompanies, publicCandidates, onProgress
    } = input;

    const subsystem = subsystemFromFinding(classification, resolvedEvidence);
    const area = technicalArea || subsystem || 'platform engineering';
    onProgress?.('owners', `Responsibility profile: ${area} (subsystem: ${subsystem || 'n/a'}).`);

    // 1) Build provider-derived candidates (Growjo is primary).
    //    A candidate is produced ONLY when identity + role-match + company-identity
    //    all hold. Providers that carry no person data naturally produce zero
    //    candidates — no owners are invented.
    const providerCandidates: OwnerCandidate[] = [];
    const label = (src: string) => `[${src}]`;

    if (growjoData) {
      const contact = GrowjoProvider.extractContacts(growjoData);
      const pc: ProviderCompanyLike = {
        source: 'GROWJO',
        company: contact.company,
        canonical_name: contact.company,
        domain: contact.domain,
        website: contact.domain ? `https://${contact.domain}` : null,
        primary_person_name: contact.person.name,
        primary_title: contact.person.title,
        primary_email: contact.person.email,
        primary_phone: contact.person.phone,
        linkedin_url: contact.person.linkedin,
        growjo_url: growjoData.growjo_url,
        source_url: growjoData.source_url,
        retrieved_at: new Date().toISOString(),
      };
      const cand = buildProviderCandidate(pc, area, targetDomain, company, 'GROWJO_IDENTITY', onProgress);
      if (cand) providerCandidates.push(cand);
    }

    if (providerCompanies && providerCompanies.length > 0) {
      for (const pc of providerCompanies) {
        if (pc.source === 'GROWJO') continue; // already processed above
        const cand = buildProviderCandidate(pc, area, targetDomain, company, 'OFFICIAL_COMPANY_SOURCE', onProgress);
        if (cand) providerCandidates.push(cand);
      }
    }

    // 2) Merge provider (primary) + public candidates; dedupe by canonical name.
    //    When the same person appears in provider data AND on a public page,
    //    merge their evidence (corroboration). When a public candidate has no
    //    matching provider data, it enters the pool as a primary candidate.
    const merged = mergeProviderAndPublic(providerCandidates, publicCandidates, onProgress);

    onProgress?.('owners', `Candidates from person discovery (provider-agnostic): ${publicCandidates.length}.`);

    // 3) Select best + HIGH-only resolve
    const sel = OwnerSelector.select(merged, area);
    const selected = merged.length > 0
      ? DeepOwnerResolver.resolve(merged, area, classification, resolvedEvidence, onProgress as any)
      : null;

    // 4) Provenance
    let provenance: OwnerProvenance = 'VARDHAN_INFERENCE';
    if (selected && sel.candidate) {
      const ev = sel.candidate.evidence.join('\n');
      if (ev.startsWith('GROWJO_IDENTITY')) provenance = 'GROWJO_SOURCE';
      else if (ev.startsWith('OFFICIAL_COMPANY_SOURCE')) provenance = 'OFFICIAL_COMPANY_SOURCE';
      else provenance = 'OFFICIAL_COMPANY_SOURCE';
    }

    return {
      candidates: merged,
      selected,
      selectedCandidate: sel.candidate,
      ownerEvidenceString: sel.ownerEvidenceString,
      reason: sel.reason,
      provenance,
    };
  }
}
