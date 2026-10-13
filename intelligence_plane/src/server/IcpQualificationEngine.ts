/**
 * VARDHAN — ICP QUALIFICATION ENGINE (additive)
 * ─────────────────────────────────────────────────────────────────────────────
 * Evaluates whether a discovered company is a high-precision prospect worth an
 * outreach attempt. Every dimension is scored 0/1/2 with PUBLIC evidence.
 *
 * The final gate is strict: PASS requires a defensible technical signal/finding,
 * a relevant technical owner with evidence, a usable contact path, relevant
 * technical surface, and company fit. Nothing is forced through the funnel —
 * weak prospects become RESEARCH_MORE or NO_GO.
 */

import type {
  DeepSignal, DeepOwner, DeepContact,
  IcpDimension, IcpQualification, IcpFit, IcpOverall
} from './DeepTypes';
import type { CompanySurface, OwnerCandidate, Evidence, FindingClassification } from './IntelligenceCase';

export interface IcpContext {
  company: string;
  domain: string;
  surface: CompanySurface;
  signals: DeepSignal[];
  people: OwnerCandidate[];
  owner: DeepOwner | null;
  contacts: DeepContact[];
  finding: FindingClassification | null;
  evidence: Evidence[];
}

function pageCount(surface: CompanySurface, cats: string[]): number {
  return surface.discovered_pages.filter(p => p.category && cats.includes(p.category)).length;
}

function technicalKeywords(text: string): boolean {
  const t = text.toLowerCase();
  return /(platform|infra|infrastructure|kubernetes|microservice|api|developer|scal|cloud|observability|reliability|sre|security|devops|backend)/i.test(t);
}

export class IcpQualificationEngine {
  static qualify(ctx: IcpContext): IcpQualification {
    const dims: IcpDimension[] = [];

    // 1. Industry fit — engineering-heavy / developer / platform / infra / SaaS?
    const techPageCats = ['developers', 'docs', 'api', 'engineering', 'technology', 'security', 'status_ops'];
    const techPages = pageCount(ctx.surface, techPageCats);
    const hasTechSignal = ctx.signals.some(s => technicalKeywords(s.excerpt) || ['ARCHITECTURE_DISCUSSION', 'API_REFERENCE', 'TECHNICAL_HIRING', 'SECURITY_PAGE'].includes(s.type));
    const industryFitScore: 0 | 1 | 2 =
      (techPages >= 2 && hasTechSignal) ? 2 :
      (techPages >= 1 || hasTechSignal) ? 1 : 0;
    dims.push({
      name: 'industry_fit',
      score: industryFitScore,
      evidence: [
        ...(techPages ? [`${techPages} technical surface page(s) discovered (/developers, /docs, /api, /engineering, /security, /status).`] : []),
        ...(hasTechSignal ? ['Technical signals (architecture/API/hiring/security) detected.'] : [])
      ]
    });

    // 2. Technical complexity
    const hiMedSignals = ctx.signals.filter(s => s.signal_strength === 'HIGH' || s.signal_strength === 'MEDIUM');
    const archSignals = ctx.signals.filter(s => s.type === 'ARCHITECTURE_DISCUSSION');
    const scaleSignals = ctx.signals.filter(s => s.type === 'ENGINEERING_ARTICLE');
    const techComplexityScore: 0 | 1 | 2 =
      (archSignals.length > 0 && hiMedSignals.length >= 1) ? 2 :
      hiMedSignals.length >= 1 ? 1 : 0;
    dims.push({
      name: 'technical_complexity',
      score: techComplexityScore,
      evidence: [
        ...(archSignals.length ? [`${archSignals.length} architecture/infrastructure signal(s).`] : []),
        ...(scaleSignals.length ? [`${scaleSignals.length} scaling/reliability signal(s).`] : [])
      ]
    });

    // 3. Product relevance — developer-facing product
    const devPage = pageCount(ctx.surface, ['developers', 'docs', 'api']);
    const apiSignal = ctx.signals.some(s => s.type === 'API_REFERENCE');
    const hiringSignal = ctx.signals.some(s => s.type === 'TECHNICAL_HIRING');
    const productRelevanceScore: 0 | 1 | 2 =
      (devPage > 0 && apiSignal && hiringSignal) ? 2 :
      (devPage > 0 || apiSignal) ? 1 : 0;
    dims.push({
      name: 'product_relevance',
      score: productRelevanceScore,
      evidence: [
        `Developer/API surface pages: ${devPage}.`,
        ...(apiSignal ? ['Public API / SDK / developer portal signal present.'] : []),
        ...(hiringSignal ? ['Public technical hiring signal present.'] : [])
      ]
    });

    // 4. Engineering maturity
    const maturityTypes = ['STATUS_PAGE', 'ENGINEERING_ARTICLE', 'PUBLIC_INCIDENT', 'SECURITY_PAGE'];
    const maturitySignals = ctx.signals.filter(s => maturityTypes.includes(s.type));
    const engMaturityScore: 0 | 1 | 2 =
      maturitySignals.length >= 3 ? 2 :
      maturitySignals.length >= 1 ? 1 : 0;
    dims.push({
      name: 'engineering_maturity',
      score: engMaturityScore,
      evidence: maturitySignals.length
        ? maturitySignals.map(s => `${s.type} — ${s.source_url}`)
        : ['No maturity signal (blog/status/security/incident) detected.']
    });

    // 5. Infrastructure relevance — infra/platform/SRE/security surface or hires
    const infraText = ['infra', 'infrastructure', 'platform', 'sre', 'devops', 'security', 'kubernetes', 'cloud'];
    const infraHiring = ctx.signals.some(s => s.type === 'TECHNICAL_HIRING' && infraText.some(k => s.excerpt.toLowerCase().includes(k)));
    const infraArch = ctx.signals.some(s => s.type === 'ARCHITECTURE_DISCUSSION' && infraText.some(k => s.excerpt.toLowerCase().includes(k)));
    const infraSec = ctx.signals.some(s => s.type === 'SECURITY_PAGE');
    const infraRelevanceScore: 0 | 1 | 2 =
      (infraHiring && (infraArch || infraSec)) ? 2 :
      (infraHiring || infraArch || infraSec) ? 1 : 0;
    dims.push({
      name: 'infrastructure_relevance',
      score: infraRelevanceScore,
      evidence: [
        ...(infraHiring ? ['Public infra/platform/SRE/security hiring detected.'] : []),
        ...(infraArch ? ['Architecture/infrastructure stack discussion detected.'] : []),
        ...(infraSec ? ['Public security/compliance posture detected.'] : [])
      ]
    });

    // 6. Observable technical signal — defensible signal OR engine finding
    const defensibleTypes = ['PUBLIC_INCIDENT', 'STATUS_PAGE', 'API_REFERENCE', 'ARCHITECTURE_DISCUSSION', 'SECURITY_PAGE', 'TECHNICAL_HIRING'];
    const defensibleSignals = ctx.signals.filter(s => defensibleTypes.includes(s.type) && s.signal_strength !== 'LOW');
    const findingIsDefensible = !!ctx.finding && !['GENERIC_ENGINEERING_ARTICLE', 'UNEXPECTED_PUBLIC_BEHAVIOR', 'CONFLICTING_EVIDENCE'].includes(ctx.finding.finding_type);
    const observableScore: 0 | 1 | 2 =
      (findingIsDefensible || defensibleSignals.length >= 1) ? 2 :
      ctx.signals.length >= 1 ? 1 : 0;
    dims.push({
      name: 'observable_technical_signal',
      score: observableScore,
      evidence: [
        ...(findingIsDefensible ? [`Engine finding: ${ctx.finding!.finding_type} (${ctx.finding!.impact_severity}).`] : []),
        ...(defensibleSignals.length ? [`${defensibleSignals.length} defensible technical signal(s).`] : []),
        ...(ctx.signals.length ? [`${ctx.signals.length} total technical signal(s).`] : [])
      ]
    });

    // 7. Owner availability
    const hiOwner = ctx.people.some(c => c.confidence === 'HIGH');
    const medOwner = ctx.people.some(c => c.confidence === 'MEDIUM');
    const ownerScore: 0 | 1 | 2 =
      hiOwner ? 2 : medOwner ? 1 : 0;
    dims.push({
      name: 'owner_availability',
      score: ownerScore,
      evidence: [
        ...(ctx.owner ? [`Selected owner: ${ctx.owner.name} (${ctx.owner.role}) — ${ctx.owner.confidence}.`] : []),
        `Owner candidates discovered: ${ctx.people.length}.`,
        ...(ctx.owner && ctx.owner.owner_evidence.length ? [`Owner evidence: ${ctx.owner.owner_evidence[0].slice(0, 120)}`] : [])
      ]
    });

    // 8. Contactability (usable professional channel)
    const profChannel = ctx.contacts.some(c => c.type === 'PROFESSIONAL_EMAIL' || c.type === 'PROFESSIONAL_PROFILE');
    const anyChannel = ctx.contacts.length > 0;
    const contactScore: 0 | 1 | 2 =
      profChannel ? 2 : anyChannel ? 1 : 0;
    dims.push({
      name: 'contactability',
      score: contactScore,
      evidence: [
        ...(ctx.contacts.length ? ctx.contacts.map(c => `${c.type} @ ${c.source_url}`) : []),
        'Never guesses or constructs emails — only captures publicly visible contacts.'
      ]
    });

    // ── Strict gate ─────────────────────────────────────────────────────────
    // COMMERCIAL-INTELLIGENCE MODEL: The core product is
    //   COMPANY → PUBLIC TECHNICAL PROBLEM → DIAGNOSTIC OPPORTUNITY
    // A defensible finding is the primary gate. Owner/email (contactability)
    // is secondary — the human operator handles contact manually.
    const minDim = (d: IcpDimension) => d.score;
    const industryOk = industryFitScore >= 1;
    const technicalOk = techComplexityScore >= 1 || productRelevanceScore >= 1;
    const signalOk = observableScore >= 1;
    const ownerOk = ownerScore >= 1 && !!ctx.owner && ctx.owner.owner_evidence.length > 0;
    const contactOk = contactScore >= 1;

    let overall: IcpOverall;
    let gated_reason: string | undefined;
    let fit: IcpFit;

    const reasons: string[] = [];

    if (!industryOk) reasons.push('Company does not present an engineering/developer/infra/technical surface.');
    if (!technicalOk) reasons.push('No relevant technical surface (API/developer/architecture/pages).');
    if (!signalOk) reasons.push('No defensible technical signal or finding observed.');
    if (!ownerOk) reasons.push('No evidence-backed technical owner discovered.');
    if (!contactOk) reasons.push('No usable public professional contact channel.');

    const surfaceEmpty = ctx.surface.discovered_pages.length <= 1 && techPages === 0;
    const noProspectSignal = !signalOk && !ownerOk && !contactOk && !technicalOk;

    if (!industryOk && !findingIsDefensible) {
      // Not a tech target AND no defensible finding → NO_GO
      if (surfaceEmpty || noProspectSignal) {
        overall = 'NO_GO';
        gated_reason = 'Not a qualifying engineering/developer target; no technical surface, signal, owner, or contact discovered.';
      } else {
        overall = 'NO_GO';
        gated_reason = reasons.join(' ');
      }
    } else if (!findingIsDefensible) {
      // Has some technical surface but no defensible finding → RESEARCH_MORE.
      overall = 'RESEARCH_MORE';
      const detail = reasons.length ? reasons.join(' ') : '';
      gated_reason = detail + (detail ? ' ' : '') + 'no defensible actionable finding (OBSERVED_*/POSSIBLE_* required for outreach).';
    } else {
      // COMMERCIAL-INTELLIGENCE MODEL: a defensible actionable finding is sufficient.
      // Contactability (owner/email) is OPTIONAL — the human handles contact manually.
      overall = 'OUTREACH_READY';
      gated_reason = undefined;
    }

    const sum = dims.reduce((a, d) => a + d.score, 0);
    if (overall === 'OUTREACH_READY' || sum >= 10) fit = 'STRONG';
    else if (sum >= 4) fit = 'WEAK';
    else fit = 'POOR';

    return { overall, fit, dimensions: dims, reasons, gated_reason };
  }
}
