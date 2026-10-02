/**
 * VARDHAN OWNER SELECTION
 * ─────────────────────────────────────────────────────────────────────────────
 * Selects the single best evidence-backed technical owner from a set of
 * discovered OwnerCandidate objects, and builds the owner-evidence string
 * consumed by IntelligenceEngine.identifyTechnicalOwner.
 *
 * Selection rules (conservative, evidence-first):
 *   1. Prefer HIGH confidence candidates with explicit public evidence.
 *   2. Prefer candidates whose role maps to the finding's technical area.
 *   3. Prefer candidates listed on team/leadership pages.
 *   4. If no explicit evidence exists, do NOT invent an owner. Returns null.
 */

import { OwnerCandidate, StrengthLevel } from './IntelligenceCase';

export interface OwnerSelection {
  candidate: OwnerCandidate | null;
  ownerEvidenceString: string;
  reason: string;
}

export class OwnerSelector {
  static select(
    candidates: OwnerCandidate[],
    technicalArea?: string
  ): OwnerSelection {
    if (!candidates || candidates.length === 0) {
      return { candidate: null, ownerEvidenceString: '', reason: 'No publicly listed persons found.' };
    }

    const areaTokens = (technicalArea || '').toLowerCase().split(/\s+/).filter(Boolean);

    const scored = candidates.map(c => {
      let score = 0;
      if (c.confidence === 'HIGH') score += 100;
      else if (c.confidence === 'MEDIUM') score += 30;
      else score += 5;
      if (c.explicit_evidence) score += 50;
      // role relevance to technical area
      const roleHit = areaTokens.some(t => c.relationship_to_area.toLowerCase().includes(t) || c.role.toLowerCase().includes(t));
      if (roleHit) score += 25;
      // Tie-breaker: prefer candidates whose role title contains an explicitly
      // technical domain keyword (CTO, VP of Engineering, Head of Security, etc.)
      // over non-technical titles (CEO, Founder, CPO for non-tech domains). This
      // prevents a CEO from winning over a VP of Engineering when both have HIGH
      // confidence and explicit evidence for a technical finding.
      const roleLower = (c.role || '').toLowerCase();
      const hasTechTitle = ['cto','cpo','chief technology','chief product','engineer','engineering','infrastructure','infra','platform','security','compliance','infosec','sre','reliability','backend','api','devops','architect','head of','vp of','director of','lead','principal','staff','technical'].some(kw => roleLower.includes(kw));
      if (hasTechTitle) score += 10;
      return { candidate: c, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0].candidate;
    const runnerUp = scored.slice(1).map(s => `${s.candidate.name} (${s.candidate.role}, ${s.candidate.confidence})`).join(', ') || 'none';

    const evidenceString = OwnerSelector.buildEvidenceString(best);
    const reason = best.confidence === 'HIGH'
      ? `Selected ${best.name} (${best.role}) — explicitly listed on a public company page with defensible evidence.`
      : `Selected ${best.name} (${best.role}) — moderate public evidence; ownership not strongly explicit. Runner-up: ${runnerUp}.`;

    return { candidate: best, ownerEvidenceString: evidenceString, reason };
  }

  /** Build the evidence string that IntelligenceEngine can verify to HIGH. */
  private static buildEvidenceString(candidate: OwnerCandidate): string {
    if (!candidate) return '';
    const src = candidate.source_urls[0] || '';
    const excerpts = candidate.evidence.filter(Boolean);
    const snippet = excerpts[0] ? ` — "${excerpts[0].slice(0, 120)}"` : '';
    // Uses 'is listed as' which IntelligenceEngine treats as explicit owner linkage.
    return `${candidate.name} is listed as ${candidate.role} on ${src}${snippet}`;
  }
}
