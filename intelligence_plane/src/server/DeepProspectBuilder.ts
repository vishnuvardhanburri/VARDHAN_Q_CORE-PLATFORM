/**
 * VARDHAN — DEEP PROSPECT BUILDER (additive)
 * ─────────────────────────────────────────────────────────────────────────────
 * High-precision prospect research operator. Starting from a company URL it:
 *
 *   company → surface → engineering → signals → qualification(prelim)
 *   → people → owners → evidence → findings → contactability
 *   → qualification(final) → email → decision
 *
 * It REUSES the existing pipeline (PublicLinkDiscovery, PeopleExtractor,
 * OwnerSelector, LivePublicObservationProvider, IntelligenceEngine) and LAYERS
 * deep signals, ICP qualification, contactability, owner-graph and a finding-led
 * email on top. Evidence IDs are preserved end-to-end via the IntelligenceCase
 * reference carried in the dossier.
 */

import path from 'path';
import fs from 'fs';
import { IntelligenceEngine } from './IntelligenceEngine';
import { LivePublicObservationProvider } from './LivePublicObservationProvider';
import { PublicLinkDiscovery, categorizeProfessionalPath } from './PublicLinkDiscovery';
import { subsystemFromFinding, DeepOwnerResolver } from './DeepOwnerResolver';
import { PeopleExtractor } from './PeopleExtractor';
import type {
  DeepBuilderOptions, DeepBuilderResult, DeepProspect, DeepSignal,
  DeepOwner, DeepContact, IcpQualification, DeepDecision, DeepConfidence,
  DeepStage, DeepEmailDraft, DeepFinding, EvidenceProvenance,
  ProviderCompanyLike, GrowjoCompany, CompanyResolution, GithubRepoMeta, ActivityEvent,
  DiagnosticOpportunity, OutreachCardFields
} from './DeepTypes';
import type {
  IntelligenceCase, Evidence, OwnerCandidate, CompanySurface, FindingClassification, FindingType, SeverityLevel, StrengthLevel, DiscoveredPage
} from './IntelligenceCase';
import { DeepSignalExtractor } from './DeepSignalExtractor';
import { ContactabilityFinder } from './ContactabilityFinder';
import { OwnerSelector } from './OwnerSelector';
import { OwnerPipeline } from './OwnerPipeline';
import { PersonDiscoveryEngine } from './PersonDiscoveryEngine';
import { GitHubDiscovery } from './GitHubDiscovery';
import { ActivityTimeline } from './ActivityTimeline';
import { IcpQualificationEngine, type IcpContext } from './IcpQualificationEngine';
import { buildOpportunity, buildOutreachCardFields } from './DiagnosticOpportunityEngine';
import { DataSufficiencyChecker } from './DataSufficiencyChecker';
import { LiveWebResearchProvider } from './LiveWebResearchProvider';
import { ChangeDetector, snapshotFromProspect } from './ChangeDetector';
import { FreshnessEngine } from './FreshnessEngine';
import { AdaptiveInvestigationEngine, type AdaptiveInvestigationOptions, type AdaptiveInvestigationRecord, type AdaptiveInvestigationAggregate, type AdaptiveInvestigationResult } from './AdaptiveInvestigationEngine';
import { EntryPointDiscovery } from './EntryPointDiscovery';
import { EntryPointGraphBuilder, attachRelationsToAnchors } from './EntryPointGraph';
import { EntryPointChangeDetector } from './EntryPointChangeDetector';
import { ExpectationEngine } from './ExpectationEngine';
import { DifferentialFindingEngine } from './DifferentialFindingEngine';
import { InvestigationPlanner } from './InvestigationPlanner';

import type {
  ExpectedBehavior,
  BehavioralObservation,
  BehaviorDifferential,
  DifferentialState,
  ProblemFinding,
  InvestigationPlan,
} from './findings/ProblemFinding';
import { TechnicalProblemDetector, type ProblemDetectorOptions, type ProblemDetectionResult } from './TechnicalProblemDetector';

/**
 * Language cues that an observation is *exposed without authentication*.
 * Shared by the R7 public-exposure rule and the adversarial-corroboration
 * (conflict) check so the two paths never diverge on matching semantics.
 */
const EXPOSURE_LANGUAGE_RE = /\b(unauthenticated|without\s+auth|publicly\s+accessible|open\s+to|exposed|disclosed|accessible\s+without|directory\s+listing|backup\s+file|debug=|env|config\s+exposed)\b/i;
/**
 * Language cues that an observation reports an auth *denial* (401/403 boundary).
 * Shared by the R8 access-issue rule and the adversarial-corroboration check.
 */
const DENIAL_LANGUAGE_RE = /\b(unauthorized|forbidden|denied|access denied|requires? authentication|authentication required)\b/i;

/**
 * Finding types that are NOT actionable for outreach.
 * These represent documented/published facts about the company (compliance
 * certifications, product rate limits, scaling constraints) — not active technical
 * problems that an engineer would need to act on. A compliance page listing
 * ISO 27001 is a positive organizational statement, not a defect or risk.
 *
 * Only OBSERVED_* and POSSIBLE_* findings (actual technical behaviors
 * observed against the public surface) count as ACTIONABLE_FINDING for the
 * outreach gate.
 */
const NON_ACTIONABLE_FINDING_TYPES = new Set([
  'DOCUMENTED_SECURITY_POSTURE',
  'DOCUMENTED_SCALING_CONSTRAINT',
  'DOCUMENTED_INCIDENT',
  'DOCUMENTED_ENGINEERING_FAILURE',
]);

/**
 * Keywords that indicate an explicitly technical role or domain relevance.
 * These must appear in the owner's role or evidence text for the owner to be
 * considered relevant to a finding. "Co-Founder", "CEO", "Founder" are NOT in
 * this list — they are business roles, not technical roles. We do NOT infer
 * technical ownership from a founder title or the company's product.
 */
const TECHNICAL_ROLE_KEYWORDS = [
  'cto', 'cpo', 'chief technology', 'chief product',
  'engineer', 'engineering', 'infrastructure', 'infra', 'platform',
  'security', 'compliance', 'infosec', 'sre', 'reliability',
  'backend', 'api', 'devops', 'architect', 'head of', 'vp of',
  'director of', 'lead', 'principal', 'staff', 'technical',
];

/**
 * Check whether the owner's evidence EXPLICITLY mentions a technical keyword
 * related to the finding's domain. A "Co-Founder" with evidence like "listed as
 * Co-Founder" does NOT satisfy this — we do not infer technical ownership from
 * a business title or the company's product. Only titles like CTO, Head of
 * Engineering, Security Engineer, etc. that explicitly contain technical domain
 * terms pass.
 */
function ownerEvidenceMatchesDomain(
  owner: { owner_evidence?: string[]; role?: string; evidence?: string[] } | null,
  findingType: string
): boolean {
  if (!owner) return false;
  // Combine all explicit evidence text from the owner record.
  const combined = [
    owner.role || '',
    ...(owner.owner_evidence || []),
    ...(owner.evidence || []),
  ].join(' ').toLowerCase();
  // Must contain at least one explicitly technical keyword. This rejects
  // "Co-Founder", "CEO", "Founder" (no technical term in role/evidence).
  // But accepts "CTO", "Head of Engineering", "Security Lead", etc.
  return TECHNICAL_ROLE_KEYWORDS.some(kw => combined.includes(kw));
}

function technicalAreaFromSurface(surface: CompanySurface): string {
  const paths = surface.discovered_pages.map(p => (p.path || '').toLowerCase()).filter(Boolean);
  if (paths.some(p => p.startsWith('/status') || p.includes('incident'))) return 'observability status';
  if (paths.some(p => p.startsWith('/security'))) return 'security trust';
  if (paths.some(p => p.startsWith('/api') || p.startsWith('/docs'))) return 'api surface';
  if (paths.some(p => p.startsWith('/blog'))) return 'engineering blog';
  return 'platform engineering';
}

function inferIndustry(surface: CompanySurface, signals: DeepSignal[]): string {
  const cats = surface.discovered_pages.map(p => p.category).filter(Boolean);
  const paths = surface.discovered_pages.map(p => (p.path || '').toLowerCase());
  const hasInfra = signals.some(s => /infra|platform|sre|security/i.test(s.excerpt));
  const hasApi = paths.some(p => p.startsWith('/api') || p.startsWith('/developers') || p.startsWith('/docs')) || signals.some(s => s.type === 'API_REFERENCE');
  const hasSecurity = cats.includes('security') || signals.some(s => s.type === 'SECURITY_PAGE');
  if (hasInfra && hasApi) return 'Infrastructure / Developer Platform';
  if (hasApi) return 'Developer Platform / SaaS';
  if (hasSecurity) return 'Security / Trust Engineering';
  if (cats.includes('blog') || cats.includes('engineering')) return 'Engineering-First SaaS';
  return 'SaaS';
}

function anglesFrom(signals: DeepSignal[], finding: FindingClassification | null): { primary: string; secondary: string | null } {
  const ordered = [...signals].sort((a, b) => (signalRank(b) - signalRank(a)));
  const top = ordered[0];
  let primary: string;
  if (finding && finding.finding_type !== 'GENERIC_ENGINEERING_ARTICLE') {
    primary = `Finding-led: ${finding.finding_type.replace(/_/g, ' ').toLowerCase()} (${finding.impact_severity})`;
  } else if (top) {
    primary = top.relevance;
  } else {
    primary = 'General technical surface observation.';
  }
  const secondary = ordered.slice(1, 3).map(s => s.relevance).join('; ') || null;
  return { primary, secondary };
}

function signalRank(s: DeepSignal): number {
  const order: Record<string, number> = {
    'PUBLIC_INCIDENT': 8, 'API_REFERENCE': 7, 'SECURITY_PAGE': 6,
    'ARCHITECTURE_DISCUSSION': 5, 'TECHNICAL_HIRING': 4,
    'STATUS_PAGE': 4, 'ENGINEERING_ARTICLE': 3, 'BLOG': 2
  };
  const strength = { HIGH: 3, MEDIUM: 2, LOW: 1 }[s.signal_strength];
  return (order[s.type] || 1) * strength;
}

export class DeepProspectBuilder {
  private readonly fetcher?: (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;
  private readonly saveArtifact?: (path: string, data: string) => void;
  private readonly onProgress?: (stage: DeepStage, message: string) => void;
  private readonly logger?: (msg: string) => void;
  private readonly maxDiscoveryPages: number;
  private readonly discoveryDelayMs: number;
  private readonly discoveryTimeoutMs: number;
  private readonly observationDelayMs: number;
  private readonly injectedProvider: any;
  private readonly artifactsBaseDir?: string;
  private readonly growjoData?: GrowjoCompany | null;
  private readonly providerCompanies?: ProviderCompanyLike[] | null;
  private readonly resolution?: CompanyResolution | null;
  private readonly searchProvider?: any;
  private readonly statePersistence?: any;
  private readonly skipLiveWebResearch?: boolean;
  private readonly enableAdaptiveInvestigation: boolean;
  private readonly adaptiveInvestigationOptions?: AdaptiveInvestigationOptions;

  constructor(options: DeepBuilderOptions = {}) {
    this.fetcher = options.fetcher;
    this.saveArtifact = options.saveArtifact;
    this.onProgress = options.onProgress;
    this.logger = options.logger;
    this.maxDiscoveryPages = options.maxDiscoveryPages ?? 12;
    this.discoveryDelayMs = options.discoveryDelayMs ?? 250;
    this.discoveryTimeoutMs = options.discoveryTimeoutMs ?? 8000;
    this.observationDelayMs = options.observationDelayMs ?? 200;
    this.injectedProvider = options.observationProvider;
    this.artifactsBaseDir = options.artifactsBaseDir;
    this.growjoData = options.growjo;
    this.providerCompanies = options.providerCompanies;
    this.resolution = options.resolution;
    this.searchProvider = options.searchProvider;
    this.statePersistence = options.statePersistence;
    this.skipLiveWebResearch = options.skipLiveWebResearch ?? false;
    this.enableAdaptiveInvestigation = options.enableAdaptiveInvestigation ?? false;
    this.adaptiveInvestigationOptions = options.adaptiveInvestigationOptions;
  }

  async build(targetUrl: string): Promise<DeepBuilderResult> {
    let parsed: URL;
    try {
      parsed = new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`);
    } catch (e: any) {
      throw new Error(`Invalid company URL: ${targetUrl} (${e?.message || e})`);
    }

    const htmlByUrl = new Map<string, string>();
    const auditTrail: string[] = [];

    this.onProgress?.('company', `${parsed.hostname} — deep intelligence run starting.`);
    auditTrail.push(`Deep run initiated for ${parsed.hostname}`);

    // 1) SURFACE DISCOVERY (bounded, same-origin, read-only) — reuse existing infra
    this.onProgress?.('surface', `discovering public company surface for ${parsed.hostname}`);
    let surface: CompanySurface;
    try {
      surface = await PublicLinkDiscovery.discover(parsed.href, {
        maxPages: this.maxDiscoveryPages,
        delayMs: this.discoveryDelayMs,
        timeoutMs: this.discoveryTimeoutMs,
        fetcher: this.fetcher,
        logger: (m) => { this.logger?.(m); auditTrail.push(m); },
        onProgress: (page) => this.onProgress?.('surface', `[pages] ${page.category}  ${page.path}  (HTTP ${page.status ?? '?'})`),
        onHtml: (url, html) => { htmlByUrl.set(url, html); }
      });
    } catch (e: any) {
      this.onProgress?.('surface', `Discovery failed: ${e?.message || String(e)}`);
      return this.failProspect(parsed, htmlByUrl, auditTrail, `Discovery failed: ${e?.message || String(e)}`);
    }
    auditTrail.push(`Surface discovered: ${surface.discovered_pages.length} public page(s).`);

    // 1c) DATA COMPLETENESS CHECK (§1) — dataset is a seed, not final truth
    const providerCompany = (this.providerCompanies?.[0] ?? this.growjoData) as any;
    const sufficiency = DataSufficiencyChecker.check(providerCompany ?? null, surface);
    this.onProgress?.('completeness', `Data sufficiency: sufficient=${sufficiency.sufficient}, needs_live_research=${sufficiency.needs_live_research}`);
    if (sufficiency.reasons.length > 0) {
      for (const r of sufficiency.reasons) this.onProgress?.('completeness', `  — ${r}`);
    }

    // Live-web research fallback (§2) — when dataset is incomplete/stale
    let liveEvidence: Evidence[] = [];
    let searchQueries: { query: string; results: number; cached: boolean }[] = [];
    let liveWebResearched = false;
    let liveWebHtml = new Map<string, string>();

    if (!this.skipLiveWebResearch && sufficiency.needs_live_research) {
      this.onProgress?.('search', 'Dataset incomplete/stale → triggering live-web research (§2).');
      liveWebResearched = true;

      const researcher = new LiveWebResearchProvider();
      try {
        const result = await researcher.research({
          context: {
            company: surface.company,
            domain: parsed.hostname,
            personName: providerCompany?.primary_person_name,
            technicalTopic: technicalAreaFromSurface(surface),
          },
          maxStage: 4,
          maxResultsPerQuery: 8,
          searchProvider: this.searchProvider,
          fetcher: this.fetcher as any,
          onProgress: (stage, msg) => this.onProgress?.(stage as any, msg),
        });

        // Merge live-web evidence, html, and owner candidates
        liveEvidence = result.evidence;
        searchQueries = result.queries_executed;
        liveWebHtml = result.htmlByUrl;

        // Merge discovered pages from live-web into surface
        for (const p of result.discovered_pages) {
          if (!surface.discovered_pages.some(sp => sp.url === p.url)) {
            surface.discovered_pages.push(p);
          }
        }

        if (result.search_available) {
          this.onProgress?.('search', `Search available via ${result.search_provider}: ${searchQueries.filter(q => !q.cached).length} new query(ies) executed.`);
        } else {
          this.onProgress?.('search', 'SEARCH_UNAVAILABLE — continuing with direct public sources only.');
        }

        if (result.errors.length > 0) {
          for (const err of result.errors) this.onProgress?.('search', `  [error] ${err}`);
        }

        auditTrail.push(`Live-web research: ${liveEvidence.length} evidence, ${searchQueries.length} queries, ${result.errors.length} errors.`);

        // Merge live-web owner candidates into people discovery
        if (result.owner_candidates.length > 0) {
          this.onProgress?.('people', `Live-web person discovery: ${result.owner_candidates.length} additional candidate(s).`);
        }
      } catch (e: any) {
        auditTrail.push(`Live-web research error: ${e?.message || String(e)}`);
        this.onProgress?.('search', `Live-web research error: ${e?.message || String(e)}`);
      }
    } else if (sufficiency.sufficient) {
      this.onProgress?.('completeness', 'Dataset sufficient — continuing without live-web research.');
    } else {
      this.onProgress?.('completeness', 'Live-web research skipped (disabled by config).');
    }

    // Merge live-web HTML into the working map
    for (const [url, html] of liveWebHtml) {
      if (!htmlByUrl.has(url)) htmlByUrl.set(url, html);
    }

    // 1d) STATE PERSISTENCE — check for prior state (resume / refresh / changes)
    let priorChanges: any[] = [];
    if (this.statePersistence) {
      this.onProgress?.('sources', `Checking prior research state for ${parsed.hostname}`);
      try {
        const prior = this.statePersistence.load(parsed.hostname);
        if (prior) {
          // Detect changes vs. prior state
          priorChanges = ChangeDetector.detect(
            null, // current not yet built — we'll do a final diff after build
            prior.state_snapshot
          );
          this.onProgress?.('sources', `Found prior state (${prior.last_researched_at}) — ${priorChanges.length} change(s) recorded.`);
        } else {
          this.onProgress?.('sources', 'No prior state found (first run for this company).');
        }
      } catch (e: any) {
        this.onProgress?.('sources', `State persistence load error: ${e?.message || String(e)}`);
        auditTrail.push(`State load error: ${e?.message || String(e)}`);
      }
    }

    // 1b) BROAD DISCOVERY — robots.txt (sitemap hints), sitemap.xml (URL list),
    // and JSON-LD sameAs (provenance-tracked public links). Bounded + same-origin.
    await this.broadenSurface(parsed, surface, htmlByUrl);
    auditTrail.push(`Broad discovery complete: ${surface.discovered_pages.length} public page(s) after robots/sitemap/JSON-LD.`);

    // 2) ENGINEERING / TECH PAGE FOCUS
    const engPages = surface.discovered_pages.filter(p =>
      p.category === 'engineering' || p.category === 'docs' || p.category === 'security' ||
      p.category === 'status_ops' || p.path.startsWith('/api') || p.path.startsWith('/developers')
    );
    this.onProgress?.('engineering', `Found ${engPages.length} engineering/technical page(s).`);
    for (const p of engPages) this.onProgress?.('engineering', `  ${p.url}`);

    const technicalArea = technicalAreaFromSurface(surface);
    const industry = inferIndustry(surface, []);

    // 3) DEEP SIGNAL DISCOVERY
    const signalObs = surface.discovered_pages;
    let signals = DeepSignalExtractor.extract(signalObs, htmlByUrl, [], surface.company || '', { onProgress: (s: string, m: string) => this.onProgress?.('signals', m) });
    this.onProgress?.('signals', `Extracted ${signals.length} technical signals (documented facts / observations / inferences).`);

    // Preliminary qualification from surface + signals only
    const prelimCtx = {
      company: surface.company, domain: parsed.hostname, surface,
      signals, people: [] as OwnerCandidate[], owner: null as DeepOwner | null,
      contacts: [] as DeepContact[], finding: null as FindingClassification | null,
      evidence: [] as Evidence[]
    };
    const prelim = IcpQualificationEngine.qualify(prelimCtx);
    this.onProgress?.('qualification', `Preliminary ICP: ${prelim.overall} (fit: ${prelim.fit}). Dimensions: ${prelim.dimensions.map(d => `${d.name}=${d.score}`).join(', ')}.`);

    // 4) PEOPLE DISCOVERY (autonomous — spec §3, §4, §5)
    //    Provider-agnostic: discovers people from ANY source:
    //      - Provider data (Growjo / CSV / licensed — any, not just Growjo)
    //      - Public professional pages (PeopleExtractor on ALL professional pages)
    //      - GitHub identities (company-linked repos)
    //    No provider is required. If the input dataset has no people, person
    //    discovery still runs independently via public source graph mining.
    const pagesForPeople = surface.discovered_pages.filter(p =>
      p.category !== undefined && p.category !== 'homepage'
    );
    this.onProgress?.('people', `${pagesForPeople.length} professional page(s) for person discovery.`);

    // 4b) GITHUB DISCOVERY — find company-linked repos + contributor identities.
    //     This feeds person discovery from public GitHub contributor graphs.
    this.onProgress?.('people', 'Discovering public GitHub repos for company...');
    let reposForPeople: GithubRepoMeta[] = [];
    try {
      const ghDiscoveryOpts = {
        fetcher: this.fetcher as any,
        pages: surface.discovered_pages.map(p => ({ url: p.url, html: htmlByUrl.get(p.url) || '' })),
        crawlPaths: ['/about', '/team', '/contact', '/company'],
        companyDomain: parsed.hostname,
        onProgress: (stage: string, msg: string) => this.onProgress?.('people', msg),
      };
      const ghResult = await GitHubDiscovery.discover(ghDiscoveryOpts);
      reposForPeople = ghResult.repos;
      this.onProgress?.('people', `GitHub discovery: ${reposForPeople.length} repo(s) found${ghResult.rate_limited ? ' (RATE_LIMITED)' : ''}.`);
      for (const r of reposForPeople) {
        this.onProgress?.('people', `  [github] ${r.org}/${r.repo} — ${r.stars ?? 0}★  ${r.description || ''}`);
      }
    } catch (e: any) {
      this.onProgress?.('people', `GitHub discovery error: ${e?.message || String(e)}`);
    }

    const people = await PersonDiscoveryEngine.discover({
      company: surface.company,
      domain: parsed.hostname,
      technicalArea,
      technicalAreaHints: ['api', 'backend', 'infrastructure', 'platform', 'security'],
      providerCompanies: (this.providerCompanies ?? []).concat(this.growjoData ? [{
        ...this.growjoData,
        source: 'GROWJO',
      }] as any : []),
      pages: pagesForPeople,
      htmlByUrl,
      githubRepos: reposForPeople,
      fetcher: this.fetcher as any,
      onProgress: (stage, message) => this.onProgress?.('people', message),
    });
    this.onProgress?.('people', `${people.length} owner candidate(s) discovered (provider-agnostic).`);
    for (const c of people) this.onProgress?.('people', `  [people] ${c.name} — ${c.role}  (${c.confidence})  @ ${c.source_urls[0]}`);

    // Note: live-web research HTML is already merged into htmlByUrl above,
    // so surface-based person discovery already incorporates live-web pages.

    // 5) OWNER RESOLUTION — Growjo people PRIMARY (role match → company
    // identity match → public corroboration → confidence). The HIGH-only gate
    // is enforced by DeepOwnerResolver (unchanged); we never invent owners and
    // never promote LOW/MEDIUM. Public candidates from PeopleExtractor provide
    // optional corroboration (a Growjo-identified person need NOT appear on the
    // company's own team/leadership page).
    // 5) OWNER RESOLUTION — select from pre-discovered public candidates.
    // PersonDiscoveryEngine already discovered people from ALL sources
    // (provider data, public professional pages, GitHub identities).
    // Use OwnerSelector to pick the best HIGH-confidence candidate.
    // Optional: OwnerPipeline can enhance with targeted discovery (live-web),
    // but the pipeline must still operate if it fails or is unavailable.
    let selectedOwner: DeepOwner | null = null;
    let sel = { candidate: null as any, ownerEvidenceString: '', reason: '' };
    let op: any = { candidates: [], provenance: 'NONE' };

    // Select from pre-discovered candidates first
    const ownerSel = OwnerSelector.select(people, technicalArea);
    if (ownerSel.candidate) {
      // Determine provenance from the candidate's evidence tags
      const evidenceText = (ownerSel.candidate.evidence || []).join(' ');
      const provenanceTag = evidenceText.includes('GROWJO_IDENTITY') ? 'GROWJO_SOURCE' : 'PUBLIC_SOURCE';
      // Clean garbled [BREAK] tokens from HTML-parsed team-page evidence,
      // but preserve structured evidence (e.g. GROWJO_IDENTITY tags) as-is.
      const cleanedEvidence = (ownerSel.candidate.evidence || []).map(e =>
        e.includes('[BREAK]')
          ? DeepOwnerResolver.buildEvidenceString(ownerSel.candidate as OwnerCandidate)
          : e
      );
      // finding_link is NOT set here — it requires the finding's technical domain,
      // which is only known after detectDeepFinding() runs. It will be populated
      // below only when the owner's evidence EXPLICITLY mentions the domain.
      selectedOwner = {
        ...ownerSel.candidate,
        confidence: ownerSel.candidate.confidence,
        owner_evidence: cleanedEvidence,
        responsibility_match: ownerSel.candidate.relationship_to_area,
        finding_link: undefined,
        deep_owner_provenance: provenanceTag,
      } as any;
      sel = {
        candidate: ownerSel.candidate,
        ownerEvidenceString: ownerSel.ownerEvidenceString,
        reason: ownerSel.reason,
      };
      op = {
        candidates: people,
        provenance: provenanceTag,
        candidate: ownerSel.candidate,
        ownerEvidenceString: ownerSel.ownerEvidenceString,
        reason: ownerSel.reason,
      };
    }

    // Optional: targeted owner discovery via OwnerPipeline (free-first, live-web aware).
    // This is best-effort: if it fails, we keep the pre-discovered candidates.
    // We need caseRef for finding_classification and evidence, so we do a brief
    // inline IntelligenceEngine run first if needed. For now, the OwnerPipeline
    // enhance is optional and the pre-discovered candidates are the primary source.
    // The IntelligenceEngine.run() call below will have the owner info available.
    // The targeted discovery enhancement is deferred to after caseRef is available.

    this.onProgress?.('owners', selectedOwner
      ? `Selected owner: ${selectedOwner.name} (${selectedOwner.role}) — ${selectedOwner.confidence} (responsibility: ${selectedOwner.finding_link}, provenance: ${op.provenance}).`
      : 'Owner graph: no evidence-backed owner discovered.');

    // 6) INTELLIGENCE PIPELINE (real public observation — PRODUCTION mode)
    const provider = this.injectedProvider ?? new LivePublicObservationProvider({
      onPage: (url: string, status: number, latency: number) => this.onProgress?.('evidence', `observed ${new URL(url).pathname} → HTTP ${status} (${latency}ms)`),
      fetcher: this.fetcher,
      delayMs: this.observationDelayMs
    });
    this.onProgress?.('evidence', 'observing public surface (bounded crawl)...');
    let caseRef: IntelligenceCase;
    try {
      caseRef = await IntelligenceEngine.run(
        surface.company,
        surface.homepage || surface.company_homepage || "",
        sel.candidate?.name || '',
        sel.candidate?.role || '',
        sel.ownerEvidenceString,
        [],
        'PRODUCTION',
        undefined,
        provider,
        (stage, message) => {
          if (stage === 'evidence') this.onProgress?.('evidence', message);
          else if (stage === 'findings') this.onProgress?.('findings', message);
          else if (stage === 'owner') this.onProgress?.('owners', message);
          else if (stage === 'email') this.onProgress?.('email', message);
        }
      );
    } catch (e: any) {
      auditTrail.push(`Pipeline error: ${e?.message || String(e)}`);
      return this.failProspect(parsed, htmlByUrl, auditTrail, `Pipeline error: ${e?.message || String(e)}`);
    }

    // Enhance owner resolution with targeted discovery (best-effort, free-first)
    try {
      const opPipeline = new OwnerPipeline(
        new LiveWebResearchProvider(this.fetcher),
        new PeopleExtractor()
      );
      const resolution = await opPipeline.resolve(
        parsed.hostname,
        caseRef.finding_classification ?? null,
        caseRef.evidence
      );
      if (resolution.primary_candidate && (!selectedOwner || resolution.primary_candidate.confidence === 'HIGH')) {
        selectedOwner = { ...resolution.primary_candidate } as any;
        op = {
          candidates: resolution.candidates,
          provenance: resolution.verification_state,
          candidate: resolution.primary_candidate,
          ownerEvidenceString: resolution.candidates.length > 0 ? `Corroborated via targeted discovery (${resolution.verification_state})` : '',
          reason: resolution.verification_state,
        };
        sel = {
          candidate: resolution.primary_candidate,
          ownerEvidenceString: op.ownerEvidenceString,
          reason: op.reason,
        };
      }
    } catch (e: any) {
      this.onProgress?.('owners', `Targeted owner discovery skipped (${e?.message || String(e)}). Using pre-discovered candidates.`);
    }
    // Sync owner confidence from the IntelligenceEngine's verification.
    // The engine checks for "is listed as" in the owner evidence string
    // (produced by OwnerSelector) and upgrades confidence to HIGH.
    if (caseRef.technical_owner && caseRef.technical_owner.owner_confidence === 'HIGH' && selectedOwner) {
      selectedOwner = { ...selectedOwner, confidence: 'HIGH' } as any;
      this.onProgress?.('owners', `Owner confidence synced from engine verification: HIGH.`);
    }
    auditTrail.push(`Engine decision: ${caseRef.prospect_decision}; finding: ${caseRef.finding_classification?.finding_type || 'NONE'}`);
    this.onProgress?.('findings', `finding: ${caseRef.finding_classification?.finding_type || 'NONE'} (${caseRef.finding_classification?.impact_severity || 'UNKNOWN'}); decision: ${caseRef.prospect_decision}`);
    this.onProgress?.('owners', `Owner: ${selectedOwner?.name || 'none'} — ${selectedOwner?.confidence || 'unknown'} (engine: ${caseRef.technical_owner?.owner_confidence || 'N/A'}, role: ${caseRef.technical_owner?.role || 'N/A'}).`);

    // Backfill signal → observation evidence links (by URL).
    const evByUrl = new Map<string, string[]>();
    for (const ev of caseRef.evidence) {
      const k = (ev.public_url || '').replace(/\/$/, '');
      const arr = evByUrl.get(k) || [];
      arr.push(ev.id);
      evByUrl.set(k, arr);
    }
    for (const sig of signals) {
      const k = sig.source_url.replace(/\/$/, '');
      const ids = evByUrl.get(k);
      if (ids && ids.length) {
        sig.related_evidence_ids = Array.from(new Set([...(sig.related_evidence_ids || []), ...ids]));
      }
    }

    // Deep finding discovery: map structured signals + public observations into a
    // defensible DeepFinding. Never collapses every signal to NONE; never invents.
    const deepFinding = this.detectDeepFinding(signals, caseRef.evidence);
    if (deepFinding) {
      this.onProgress?.('findings', `deep finding: ${deepFinding.finding_type} (${deepFinding.confidence}) — ${deepFinding.explanation.slice(0, 90)}`);
    } else {
      this.onProgress?.('findings', 'No defensible deep finding assembled (not fabricated).');
      // Debug: dump signal types for diagnosis
      for (const sig of signals) {
        this.onProgress?.('findings', `  [signal] ${sig.type} (${sig.signal_strength}) — "${sig.excerpt.slice(0, 100)}"`);
      }
    }

    // Populate finding_link ONLY when the owner's evidence EXPLICITLY mentions
    // the finding's technical domain. A "Co-Founder" listed on a company page
    // does NOT imply technical ownership of security/platform/infra unless the
    // evidence text explicitly connects them. Without this, finding_link stays
    // undefined and the outreach gate cannot pass (owner not relevant).
    if (deepFinding && selectedOwner) {
      const domainMatch = ownerEvidenceMatchesDomain(
        selectedOwner as any,
        deepFinding.finding_type
      );
      if (domainMatch) {
        selectedOwner = {
          ...selectedOwner,
          finding_link: subsystemFromFinding(
            caseRef.finding_classification || null,
            caseRef.evidence
          ),
        } as any;
        this.onProgress?.('owners', `Owner relevance confirmed: ${selectedOwner!.name} evidence mentions the finding's technical domain.`);
      } else {
        this.onProgress?.('owners', `Owner relevance NOT confirmed: ${selectedOwner!.name} (${selectedOwner!.role}) evidence does not mention the finding's technical domain.`);
      }
    }

    // 7) CONTACTABILITY (public professional contact channels only)
    const rawContacts = ContactabilityFinder.find(surface.discovered_pages, htmlByUrl, (stage, message) => this.onProgress?.('contactability', message));
    // Classify and link emails to the selected owner: re-classifies
    // PROFESSIONAL_EMAIL → OWNER_VERIFIED_EMAIL when explicit evidence
    // (name match + page proximity) connects the email to the person.
    // Company/role emails (oauth@, sales@, …) remain COMPANY_BUSINESS_EMAIL.
    const contacts = ContactabilityFinder.classifyAndLink(rawContacts, selectedOwner, htmlByUrl);

    // Compute contact_status for the prospect output and email gate.
    const hasOwnerVerifiedEmail = contacts.some(c => c.type === 'OWNER_VERIFIED_EMAIL');
    const hasCompanyBusinessEmail = contacts.some(c => c.type === 'COMPANY_BUSINESS_EMAIL');
    const contactStatus = hasOwnerVerifiedEmail
      ? 'OWNER_VERIFIED_EMAIL'
      : hasCompanyBusinessEmail
      ? 'COMPANY_BUSINESS_EMAIL'
      : contacts.some(c => c.type === 'PROFESSIONAL_EMAIL')
      ? 'UNVERIFIED_POSSIBLE_EMAIL'
      : contacts.some(c => c.type === 'PUBLIC_PROFESSIONAL_CONTACT' || c.type === 'PROFESSIONAL_PROFILE' || c.type === 'PROFILE' || c.type === 'LINKEDIN')
      ? 'PUBLIC_PROFESSIONAL_CONTACT'
      : contacts.length > 0
      ? 'CONTACT_PAGE'
      : 'NO_VERIFIED_CONTACT';

    // 8) FINAL ICP QUALIFICATION (all data; finding = deep finding when present)
    const authoritativeFinding = deepFinding ?? (caseRef.finding_classification || null);
    const ctx = {
      company: surface.company, domain: parsed.hostname, surface, signals, people,
      owner: selectedOwner, contacts, finding: authoritativeFinding,
      evidence: caseRef.evidence
    };
    const icp = IcpQualificationEngine.qualify(ctx);
    this.onProgress?.('qualification', `Final ICP: ${icp.overall} (fit: ${icp.fit}). ${icp.gated_reason ? icp.gated_reason : 'All gates satisfied.'}`);

    // 9) ANGLES (deep finding drives the primary angle when present)
    const { primary: primaryAngle, secondary: secondaryAngle } = anglesFrom(signals, authoritativeFinding);

    // 10) EMAIL (gated: real finding + evidence + verified owner + relevant relationship + CLAIM QA)
    const draftInput = {
      company: surface.company, domain: parsed.hostname, industry, fit: icp.fit,
      qualification_reasons: icp.reasons, public_surface: surface, technical_signals: signals,
      documented_facts: [], public_observations: [], inferences: [], people,
      owner_candidates: people, selected_owner: selectedOwner, owner_evidence: selectedOwner?.owner_evidence || [],
      contactability: contacts, contact_status: contactStatus, findings: authoritativeFinding, deep_finding: deepFinding,
      evidence: caseRef.evidence, primary_angle: primaryAngle, secondary_angle: secondaryAngle,
      recommended_subjects: [], decision: 'NO_GO' as DeepDecision, confidence: 'LOW' as DeepConfidence,
      artifact_path: '', audit_trail: auditTrail
    } as Omit<DeepProspect, 'email_draft'>;
    const email: DeepEmailDraft | null = null;

    // 11) FINAL DECISION + CONFIDENCE
    // COMMERCIAL-INTELLIGENCE MODEL (priority reset):
    //   The core product is COMPANY → PUBLIC TECHNICAL PROBLEM → DIAGNOSTIC OPPORTUNITY.
    //   A person/email is NOT required — the human operator handles contact manually.
    //
    //   OUTREACH_READY = defensible public finding + claim QA passed
    //   RESEARCH_MORE   = no defensible finding yet
    //   NO_GO           = ICP says the company is not an engineering target
    //
    const ownerHigh = !!selectedOwner && selectedOwner.confidence === 'HIGH';
    const ownerVerified = !!selectedOwner && !!selectedOwner.finding_link;

    // Actionable finding gate: only OBSERVED_* and POSSIBLE_* findings
    // represent active technical behaviors requiring outreach.
    const findingDefensible = !!deepFinding && deepFinding.confidence !== 'LOW'
      && !['GENERIC_ENGINEERING_ARTICLE', 'UNEXPECTED_PUBLIC_BEHAVIOR', 'CONFLICTING_EVIDENCE'].includes(deepFinding.finding_type)
      && !NON_ACTIONABLE_FINDING_TYPES.has(deepFinding.finding_type);

    // Claim QA: the finding must carry concrete evidence IDs (never a signal-only claim).
    const findingHasEvidence = !!deepFinding && deepFinding.evidence_ids.length > 0;
    const claimQAPassed = findingDefensible && findingHasEvidence;

    // OWNER RELEVANCE gate (retained for owner selection relevance, not a hard
    // OUTREACH_READY gate): the owner's evidence must EXPLICITLY connect them
    // to the finding's technical domain.
    const ownerRelevant = !!selectedOwner && !!selectedOwner.finding_link
      && ownerEvidenceMatchesDomain(
        selectedOwner as any,
        deepFinding?.finding_type || authoritativeFinding?.finding_type || ''
      );

    // Diagnostic opportunity generation (company → problem, NOT person-first)
    const diagnosticOpportunity = claimQAPassed
      ? buildOpportunity(
          surface.company, parsed.hostname, deepFinding, caseRef.evidence,
          signals, surface.homepage || surface.company_homepage || ""
        )
      : null;

    if (diagnosticOpportunity) {
      auditTrail.push(`DIAGNOSTIC_OPPORTUNITY: ${diagnosticOpportunity.problem_type} | relevance=${diagnosticOpportunity.commercial_relevance}`);
      this.onProgress?.('findings', `diagnostic opportunity: ${diagnosticOpportunity.problem_type} (${diagnosticOpportunity.commercial_relevance})`);
    }

    let decision: DeepDecision;
    if (icp.overall === 'NO_GO') {
      decision = 'NO_GO';
    } else if (claimQAPassed) {
      // Finding-first: a defensible, evidence-backed finding is sufficient.
      // Contactability (owner/email) is optional — the human handles contact.
      decision = 'OUTREACH_READY';
    } else if (findingDefensible && !findingHasEvidence) {
      decision = 'RESEARCH_MORE';
      auditTrail.push('Finding defensible but lacks evidence IDs (signal-only) — RESEARCH_MORE.');
    } else {
      decision = 'RESEARCH_MORE';
    }

    // Owner-related blockers are recorded as informational (not gating).
    if (decision === 'OUTREACH_READY' && findingDefensible && !ownerHigh) {
      auditTrail.push(`OWNER_NOT_REQUIRED: finding is diagnostic-ready (${deepFinding?.finding_type}); contact to be handled manually.`);
    }
    if (decision === 'OUTREACH_READY' && findingDefensible && ownerHigh && !hasOwnerVerifiedEmail) {
      auditTrail.push(`OWNER_VERIFIED_CONTACT_MISSING: owner=${selectedOwner?.name}, contact_status=${contactStatus} (diagnostic opportunity still valid — human contacts manually).`);
      this.onProgress?.('contactability', `Owner verified but no owner-linked email found (contact_status: ${contactStatus}). Diagnostic opportunity is valid; contact to be handled manually.`);
    }

    let confidence: DeepConfidence;
    if (decision === 'OUTREACH_READY') confidence = 'HIGH';
    else if (signals.length > 0 || !!selectedOwner || contacts.length > 0) confidence = 'MEDIUM';
    else confidence = 'LOW';

    const { documented_facts, public_observations, inferences } = DeepSignalExtractor.splitByProvenance(signals);

    // Broad GitHub discovery: only orgs/repos linked from the company's own pages.
    const githubPages = Array.from(htmlByUrl.entries()).map(([url, html]) => ({ url, html }));
    let githubRepos: GithubRepoMeta[] = reposForPeople;
    if (githubRepos.length === 0) {
      try {
        const gh = await GitHubDiscovery.discover({
          fetcher: this.fetcher || (globalThis.fetch as any),
          pages: githubPages,
          companyDomain: parsed.hostname,
          onProgress: (stage, msg) => this.onProgress?.('engineering', msg),
        });
        githubRepos = gh.repos;
        if (gh.rate_limited) auditTrail.push('GitHub API rate-limited during discovery.');
      } catch (e: any) {
        auditTrail.push(`GitHub discovery error: ${e?.message || String(e)}`);
      }
    }

    // Activity timeline: signals + evidence + GitHub, provenance-tracked.
    const timeline = ActivityTimeline.synthesize({
      company: surface.company, domain: parsed.hostname, signals,
      evidence: caseRef.evidence, github: githubRepos,
      finding: deepFinding ?? (caseRef.finding_classification || null),
    });

    // Adaptive Investigation Engine — runs after the standard pipeline.
    // Examines boundary observations and, when triggered, attempts pivots
    // to alternate public surfaces. Telemetry is attached to the prospect.
    let adaptiveResult = null;
    if (this.enableAdaptiveInvestigation) {
      this.onProgress?.('deepening', 'Adaptive investigation: examining boundary observations.');
      try {
        const adaptiveEngine = new AdaptiveInvestigationEngine({
          fetcher: this.fetcher,
          ...this.adaptiveInvestigationOptions,
          onProgress: (stage, msg) => this.onProgress?.(stage as any, msg),
        });
        const initialUrl = surface.homepage || surface.company_homepage || `https://${parsed.hostname}`;
        // FIX 2: Pass baseline evidence IDs for cross-run verification
        const baselineEvidenceIds = new Set(caseRef.evidence.map(e => e.id));
        adaptiveResult = await adaptiveEngine.investigate(
          surface.company,
          initialUrl,
          caseRef.evidence,
          provider instanceof LivePublicObservationProvider
            ? (provider as any).getDiscoveredSubdomains()
            : [],
          baselineEvidenceIds
        );
        this.onProgress?.('deepening', `Adaptive investigation complete: ${adaptiveResult.records.length} record(s), ${adaptiveResult.aggregate.pivots_executed} pivot(s) executed.`);
      } catch (e: any) {
        this.onProgress?.('deepening', `Adaptive investigation error: ${e?.message || String(e)}`);
        adaptiveResult = null;
      }
    }

    // ─── ENTRY POINT INTELLIGENCE (§ENTRY-POINT) ──────────────────────────
    // Build the full externally-observable technical perimeter from evidence.
    // This is EVIDENCE-BACKED — no hostnames are guessed.
    this.onProgress?.('surface', 'Building entry-point intelligence from evidence.');

    // Gather prior subdomains from state persistence for cross-source confirmation
    const priorSubdomains = new Set<string>();
    if (this.statePersistence) {
      try {
        const prior = this.statePersistence.load(parsed.hostname);
        if (prior?.state_snapshot?.entry_points) {
          for (const ep of prior.state_snapshot.entry_points) {
            priorSubdomains.add(ep.hostname);
          }
        }
      } catch { /* ignore */ }
    }

    const epDiscovery = new EntryPointDiscovery({
      organizationId: parsed.hostname,
      canonicalDomain: parsed.hostname,
      priorSubdomains,
      includeAdaptive: !!adaptiveResult,
    });

    const entryPoints = epDiscovery.discover(caseRef.evidence, surface, signals);
    const graphBuilder = new EntryPointGraphBuilder();
    const epGraph = graphBuilder.build(entryPoints);
    attachRelationsToAnchors(entryPoints, epGraph);

    const epTelemetry = EntryPointChangeDetector.computeTelemetry(
      entryPoints,
      adaptiveResult?.aggregate.pivots_executed ?? 0,
      entryPoints.filter(ep => ep.discovery_source.includes('ADAPTIVE_PIVOT')).length
    );

    // Detect changes vs. prior run
    let epChanges: any[] = [];
    if (this.statePersistence) {
      try {
        const prior = this.statePersistence.load(parsed.hostname);
        if (prior?.state_snapshot?.entry_points) {
          epChanges = EntryPointChangeDetector.detect(entryPoints, prior.state_snapshot.entry_points);
          if (epChanges.length > 0) {
            this.onProgress?.('surface', `Entry-point changes: ${epChanges.length} change(s) detected vs. prior run.`);
            for (const ch of epChanges) {
              this.onProgress?.('surface', `  ${ch.change_type}: ${ch.surface_url}`);
            }
          }
        }
      } catch (e: any) {
        epChanges = [];
      }
    }

    this.onProgress?.('surface', `Entry-point discovery complete: ${entryPoints.length} entry point(s), ${epTelemetry.total_attributed} attributed, ${epTelemetry.cross_source_confirmed} cross-source confirmed.`);

    // ─── EXPECTED-BEHAVIOR + DIFFERENTIAL FINDING PIPELINE (§NEW) ─────────────
    //  Target flow:
    //  EntryPointDiscovery → EntryPointGraph → ExpectationEngine
    //  → InvestigationPlanner → Public Observation → DifferentialFindingEngine
    //  → TechnicalProblemDetector → Verification → ProblemFinding
    //
    //  This layer compares evidence-backed EXPECTED behavior against OBSERVED
    //  behavior to determine if there is a meaningful, reproducible differential
    //  that can advance to a verified finding.

    let expectations: ExpectedBehavior[] = [];
    let observations: BehavioralObservation[] = [];
    let differentials: BehaviorDifferential[] = [];
    let technicalFindings: ProblemFinding[] = [];
    let investigationPlans: InvestigationPlan[] = [];

    try {
      // Step 1: Generate evidence-backed expectations for all entry points
      const expectationEngine = new ExpectationEngine();
      expectations = expectationEngine.generate(entryPoints, caseRef.evidence, epGraph);
      this.onProgress?.('verification', `ExpectationEngine: ${expectations.length} expected-behavior model(s) generated.`);

      // Step 2: Build behavioral observations from evidence (synthesized)
      //         and synthesize investigation plans
      const planner = new InvestigationPlanner();
      observations = [];
      investigationPlans = [];
      for (const ep of entryPoints) {
        // Build observations from evidence records that were tested without auth
        for (const eid of ep.evidence_ids) {
          const ev = caseRef.evidence.find(e => e.id === eid);
          if (ev && ev.tested_without_auth) {
            const obs = InvestigationPlanner.observationFromEvidence(ev, ep.entry_point_id);
            if (obs) observations.push(obs);
          }
        }

        // Synthesize investigation plans for verification-eligible surfaces
        if (ep.verification_eligibility.eligible) {
          const planResult = planner.plan({
            entryPoint: ep,
            allEntryPoints: entryPoints,
            graph: epGraph,
            expectations: expectations.filter(e => e.entry_point_id === ep.entry_point_id),
            observations: observations.filter(o => o.entry_point_id === ep.entry_point_id),
            evidence: caseRef.evidence,
            differentialState: observations.some(o => o.entry_point_id === ep.entry_point_id) ? 'INSUFFICIENT_EVIDENCE' : null,
          });
          if (planResult.plan && planResult.plan.action !== 'STOP') {
            investigationPlans.push(planResult.plan);
          }
        }
      }

      // Step 3: Run differential analysis (expected vs observed behavior)
      const differentialEngine = new DifferentialFindingEngine();
      differentials = differentialEngine.analyze(expectations, observations);
      const actionable = differentialEngine.filterActionable(differentials);
      differentials = differentialEngine.deduplicate(differentials);
      this.onProgress?.('verification', `DifferentialFindingEngine: ${differentials.length} differential(s), ${actionable.length} actionable.`);

      // Step 4: Run TechnicalProblemDetector on the full pipeline
      //         (uses expectations + differentials as context)
      const problemDetector = new TechnicalProblemDetector({
        maxFindingsPerEntryPoint: 3,
        minSignalConfidence: 0.4,
        minFindingConfidence: 0.6,
      });
      const detectionResult: ProblemDetectionResult = await problemDetector.detect(
        entryPoints,
        caseRef.evidence,
        epGraph
      );
      technicalFindings = detectionResult.findings;
      this.onProgress?.('verification', `TechnicalProblemDetector: ${technicalFindings.length} problem finding(s) (${detectionResult.stats.verified_findings} verified).`);
    } catch (e: any) {
      this.onProgress?.('verification', `Expected-behavior pipeline error: ${e?.message || String(e)}`);
    }

    // ─── PROSPECT ASSEMBLY ──────────────────────────────────────────────────
    const prospect: DeepProspect = {
      company: surface.company,
      domain: parsed.hostname,
      industry,
      fit: icp.fit,
      qualification_reasons: icp.reasons.length ? icp.reasons : icp.dimensions.map(d => `${d.name}: ${d.score}`),
      public_surface: surface,
      technical_signals: signals,
      documented_facts,
      public_observations,
      inferences,
      people,
      owner_candidates: op.candidates,
      selected_owner: selectedOwner ? { ...selectedOwner, deep_owner_provenance: op.provenance } : null,
      owner_evidence: selectedOwner?.owner_evidence || [],
      contactability: contacts,
      contact_status: contactStatus,
      findings: caseRef.finding_classification || null,
      deep_finding: deepFinding,
      evidence: caseRef.evidence,
      primary_angle: primaryAngle,
      secondary_angle: secondaryAngle,
      recommended_subjects: email ? email ? [email.primary_subject, email.alternate_subject].filter(Boolean) : [] : [],
      email_draft: email as any,
      decision,
      confidence,
      diagnostic_opportunity: diagnosticOpportunity,
      growjo_data: this.growjoData ?? null,
      provider_data: this.providerCompanies ?? null,
      resolution: this.resolution ?? null,
      github_activity: githubRepos,
      activity_timeline: timeline,
      data_sufficiency: {
        sufficient: sufficiency.sufficient,
        needs_live_research: sufficiency.needs_live_research,
        missing: sufficiency.missing,
        stale: sufficiency.stale,
        reasons: sufficiency.reasons,
      },
      live_web_evidence: liveEvidence,
      search_queries: searchQueries,
      live_web_researched: liveWebResearched,
      changes: priorChanges,
      adaptive_investigation: adaptiveResult ?? { attempted: false, records: [], aggregate: { boundary_observations: 0, pivots_suggested: 0, pivots_executed: 0, alternate_surfaces_found: 0, new_evidence_found: 0, new_verification_targets: 0, verified_from_adaptive_path: 0, no_useful_result: 0 } },
      entry_points: entryPoints,
      entry_point_telemetry: epTelemetry,
      entry_point_graph: epGraph,
      entry_point_changes: epChanges,
      expectations,
      observations,
      differentials,
      technical_findings: technicalFindings,
      investigation_plans: investigationPlans,
      artifact_path: '',
      audit_trail: auditTrail,
      case_ref: caseRef
    };

    // Build outreach card (problem-first, person secondary)
    prospect.outreach_card = buildOutreachCardFields(prospect, diagnosticOpportunity) as any;

    prospect.artifact_path = this.persistArtifact(prospect, parsed.hostname);

    // Final change detection vs. previously stored state (if persistence enabled)
    if (this.statePersistence && priorChanges.length === 0) {
      try {
        const prior = this.statePersistence.load(parsed.hostname);
        if (prior) {
          priorChanges = ChangeDetector.detect(prospect, prior.state_snapshot);
          this.onProgress?.('verification', `${priorChanges.length} change(s) detected vs. prior state.`);
        }
      } catch { /* ignore — changes is best-effort */ }
    }

    // Persist the new state for future resume/refresh/changes
    if (this.statePersistence) {
      try {
        const snap = snapshotFromProspect(prospect);
        if (snap) {
          this.statePersistence.save(parsed.hostname, {
            company: prospect.company,
            domain: prospect.domain,
            last_researched_at: new Date().toISOString(),
            stage_reached: prospect.live_web_researched ? 6 : 3,
            last_summary: {
              decision: prospect.decision,
              finding: prospect.deep_finding?.finding_type || prospect.findings?.finding_type || null,
              owner: prospect.selected_owner?.name || null,
              confidence: prospect.confidence,
              people_count: prospect.people.length,
              owner_candidates_count: prospect.owner_candidates.length,
              evidence_count: prospect.evidence.length,
              sources_count: prospect.public_surface.discovered_pages.length,
              technical_signals_count: prospect.technical_signals.length,
            },
            state_snapshot: snap,
            search_cache: [],
            last_error: null,
          });
          prospect.changes = priorChanges;
        }
      } catch (e: any) {
        this.onProgress?.('verification', `State persistence error: ${e?.message || String(e)}`);
      }
    }

    this.onProgress?.('decision', `Deep decision: ${decision} (confidence ${confidence}). Artifact: ${prospect.artifact_path}`);
    return { prospect, case_ref: caseRef };
  }

  /** Build a minimal NO_GO prospect when discovery/pipeline fails outright. */
  private failProspect(parsed: URL, htmlByUrl: Map<string, string>, audit: string[], reason: string): DeepBuilderResult {
    const surface: CompanySurface = {
      company: parsed.hostname, origin: parsed.origin, homepage: parsed.href,
      discovered_pages: [], page_categories: {}
    };
    const email: DeepEmailDraft = {
      primary_subject: '', alternate_subject: '', body: '', claims: [], generated: false, blocked_reason: reason
    };
    const prospect: DeepProspect = {
      company: parsed.hostname, domain: parsed.hostname, industry: 'Unknown', fit: 'POOR',
      qualification_reasons: [reason], public_surface: surface, technical_signals: [],
      documented_facts: [], public_observations: [], inferences: [], people: [],
      owner_candidates: [], selected_owner: null, owner_evidence: [], contactability: [],
      contact_status: 'NO_VERIFIED_CONTACT', findings: null, deep_finding: null, evidence: [], primary_angle: 'No surface discovered.', secondary_angle: null,
      recommended_subjects: [], email_draft: email as any, decision: 'NO_GO', confidence: 'LOW',
      diagnostic_opportunity: null, outreach_card: {},
      growjo_data: this.growjoData ?? null, provider_data: this.providerCompanies ?? null, resolution: this.resolution ?? null,
      github_activity: [], activity_timeline: [],
      data_sufficiency: { sufficient: false, needs_live_research: false, missing: [], stale: [], reasons: [reason] },
      live_web_evidence: [], search_queries: [], live_web_researched: false, changes: [],
      artifact_path: '', audit_trail: audit, case_ref: undefined
    };
    prospect.artifact_path = this.persistArtifact(prospect, parsed.hostname);
    this.onProgress?.('decision', `Deep decision: NO_GO (confidence LOW). ${reason}`);
    return { prospect, case_ref: undefined };
  }

  /**
   * BROAD DISCOVERY (robots.txt, sitemap.xml, JSON-LD sameAs). Read-only, bounded,
   * same-origin. Enriches the page graph + htmlByUrl used by signal/people/contact
   * discovery. 404s / non-2xx are silently skipped (logged, not recorded).
   */
  private async broadenSurface(parsed: URL, surface: CompanySurface, htmlByUrl: Map<string, string>): Promise<void> {
    const fetcher = this.fetcher || ((url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => (globalThis.fetch as any)(url, { method: init.method, headers: init.headers, signal: init.signal })) as unknown as import('./IntelligenceCase').HttpFetcher;
    const origin = `${parsed.protocol}//${parsed.host}`;
    const addPage = (url: string, html: string, category: DiscoveredPage['category']) => {
      const norm = url.replace(/\/$/, '');
      if (htmlByUrl.has(norm)) return;
      if (!norm.startsWith(origin)) return; // same-origin only
      try {
        const u = new URL(norm);
        const existing = surface.discovered_pages.find(p => p.url === norm || p.url === url);
        if (existing) return;
      } catch { return; }
      htmlByUrl.set(norm, html);
      surface.discovered_pages.push({ url: norm, path: new URL(norm).pathname, category, status: 200 });
    };

    // robots.txt -> <sitemap> hints.
    try {
      const res = await fetcher(`${origin}/robots.txt`, { method: 'GET', headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(8000) });
      if (res && res.ok) {
        const txt = await res.text();
        const sitemapRe = /sitemap:\s*(https?:\/\/[^\s]+)/gi;
        let m: RegExpExecArray | null;
        let count = 0;
        while ((m = sitemapRe.exec(txt)) !== null && count < this.maxDiscoveryPages) {
          const loc = m[1].trim();
          if (loc.startsWith(origin)) { /* recorded as sitemap page hint, fetched separately below */ }
          count++;
        }
      }
    } catch { /* 404 / network — skip */ }

    // sitemap.xml -> <loc> URLs (bounded, same-origin).
    try {
      const res = await fetcher(`${origin}/sitemap.xml`, { method: 'GET', headers: { accept: 'application/xml' }, signal: AbortSignal.timeout(8000) });
      if (res && res.ok) {
        const xml = await res.text();
        const locRe = /<loc>\s*(https?:\/\/[^<]+)\s*<\/loc>/gi;
        let m: RegExpExecArray | null;
        let count = 0;
        const toFetch: string[] = [];
        while ((m = locRe.exec(xml)) !== null && count < this.maxDiscoveryPages) {
          const loc = m[1].trim();
          if (loc.startsWith(origin) && !htmlByUrl.has(loc.replace(/\/$/, ''))) toFetch.push(loc);
          count++;
        }
        // Categorize and boundedly fetch sitemap URLs so they feed person/signal
        // discovery (not just 'other').
        for (const loc of toFetch.slice(0, this.maxDiscoveryPages)) {
          try {
            const r = await fetcher(loc, { method: 'GET', headers: { accept: 'text/html' }, signal: AbortSignal.timeout(6000) });
            if (r && r.ok) {
              const h = await r.text();
              const u = new URL(loc);
              addPage(loc, h, categorizeProfessionalPath(u.pathname));
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* 404 / network — skip */ }

    // JSON-LD sameAs links (provenance: documented public contact/social links).
    for (const [url, html] of Array.from(htmlByUrl.entries())) {
      try {
        const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let m: RegExpExecArray | null;
        while ((m = ldRe.exec(html)) !== null) {
          let json: any;
          try { json = JSON.parse(m[1]); } catch { continue; }
          const block: any = Array.isArray(json) ? json[0] : json;
          const sameAs: string[] = block?.sameAs || [];
          for (const link of sameAs) {
            if (!link || typeof link !== 'string') continue;
            // sameAs links (incl. github.com/<org>) are already present in htmlByUrl
            // and will be scanned by GitHubDiscovery; nothing to fabricate here.
            if (link.includes('github.com')) this.onProgress?.('engineering', `[json-ld] sameAs GitHub link found on ${url}`);
          }
        }
      } catch { /* ignore malformed JSON-LD */ }
    }

    // ── Explicit professional-path crawl ──
    // The broad crawler above follows links from the homepage, but many companies
    // don't link to their /about, /team, or /careers pages from the homepage
    // (especially React SPAs). These paths are standard locations for team/person
    // data and MUST be fetched so PeopleExtractor has a chance to find people.
    // This is read-only and bounded: only 4 high-signal paths, no recursion.
    const professionalPaths = ['/about', '/team', '/leadership', '/careers'];
    for (const ppath of professionalPaths) {
      const url = origin + ppath;
      if (htmlByUrl.has(url) || htmlByUrl.has(url.replace(/\/$/, ''))) continue;
      try {
        const r = await fetcher(url, {
          method: 'GET',
          headers: { 'User-Agent': 'VARDHAN-FREE-FIRST/1.0', 'Accept': 'text/html' },
          signal: AbortSignal.timeout(6000),
        });
        if (r && r.ok) {
          const h = await r.text();
          const u = new URL(url);
          addPage(url, h, categorizeProfessionalPath(u.pathname));
          this.onProgress?.('surface', `[broaden] explicit fetch ${u.pathname} → HTTP ${r.status}`);
        }
      } catch { /* skip — 404 or network */ }
    }
  }

  /**
   * Deep finding engine (Part B / C): assembles a defensible DeepFinding from
   * structured signals + real public observations. Correlation over multiple
   * pieces of evidence is required; a single generic engineering article never
   * becomes a finding. Returns null when nothing defensible is demonstrated.
   */
  private detectDeepFinding(signals: DeepSignal[], observations: Evidence[]): DeepFinding | null {
    const found: DeepFinding[] = [];
    const src: Evidence[] = Array.isArray(observations) ? observations : [];

    // Adversarial corroboration (Part E): when the SAME public resource carries
    // contradictory security postures — both "exposed without auth" AND
    // "denied / 401-403" — the observation substrate is internally unreliable,
    // so no defensible exposure/access finding can stand. Weaken to a LOW-
    // confidence CONFLICTING_EVIDENCE finding. The build gate maps this to
    // RESEARCH_MORE (never OUTREACH_READY). Checked FIRST so the contradiction
    // short-circuits the normal exposure/access rules.
    const conflict = this.detectConflictingEvidence(src);
    if (conflict) return conflict;

    const sensitive = src.filter(e => (e.sensitive_fields || []).length > 0);
    if (sensitive.length > 0) {
      found.push(this.deepFinding(
        'POSSIBLE_SENSITIVE_METADATA_EXPOSURE', 'MEDIUM',
        `${sensitive.length} public observation(s) documented sensitive metadata field(s).`,
        sensitive.filter(e => (e.sensitive_fields || []).length > 0),
        sensitive.map(e => e.public_url),
        'A public response carries documented sensitive metadata fields — verifiable public behavior, not a vulnerability claim.',
        'Treat the field as intentionally public only if it is part of the product data model; otherwise remove it.',
        sensitive.length >= 2 ? 'HIGH' : 'MEDIUM',
        sensitive.length >= 2 ? 'MEDIUM' : 'LOW', 'HIGH', 'HIGH', 'MEDIUM', 'MEDIUM'
      ));
    }

    // Documented security posture (compliance certifications on a security page).
    const securitySig = signals.find(s =>
      s.type === 'SECURITY_PAGE' &&
      /iso\s*27001|soc\s*2|pci\s*dss|hipaa|gdpr|fedramp|nist|iso\s*27001/i.test(s.excerpt)
    );
    if (securitySig) {
      // Extract just the certification names, stripping page noise like
      // "Frequently asked questions." that co-occurs on the security page.
      const certMatch = securitySig.excerpt.match(/(iso\s*27001|soc\s*2|pci\s*dss|hipaa|gdpr|fedramp|nist(?:\s*\d+)?)/gi);
      const certText = certMatch ? certMatch.map(c => c.toUpperCase()).join(', ') : 'compliance certifications';
      found.push(this.deepFinding(
        'DOCUMENTED_SECURITY_POSTURE', 'MEDIUM',
        `Public security/compliance page documents certifications on ${securitySig.source_url}.`,
        this.sigEvidence(securitySig, src),
        this.signalUrls(securitySig),
        `The company's public security page documents compliance certifications (${certText}). This is a published technical posture statement, not a vulnerability claim.`,
        'Verify the certifications are current before referencing; treat as organizational security context.',
        'MEDIUM', 'MEDIUM', 'HIGH', 'MEDIUM', 'HIGH', 'MEDIUM'
      ));
    }

    // Repeated 5xx -> availability issue (correlation of >= 2 occurrences).
    const fiveXx = src.filter(e => (e.status || 0) >= 500 && (e.status || 0) < 600 && e.repeatable);
    if (fiveXx.length >= 2) {
      found.push(this.deepFinding(
        'OBSERVED_AVAILABILITY_ISSUE', 'HIGH',
        `Repeated ${fiveXx.length} public 5xx responses on repeatable requests without auth.`,
        fiveXx, fiveXx.map(e => e.public_url),
        `Repeated HTTP ${fiveXx.map(e => e.status).join(', ')} responses on publicly reachable endpoints across repeatable read-only requests.`,
        'Investigate server-side error handling for the affected public endpoints.',
        fiveXx.length >= 3 ? 'HIGH' : 'MEDIUM',
        'HIGH', 'HIGH', 'HIGH', 'HIGH', 'HIGH'
      ));
    } else if (fiveXx.length === 1) {
      found.push(this.deepFinding(
        'OBSERVED_AVAILABILITY_ISSUE', 'LOW',
        `Single observed HTTP ${fiveXx[0].status} on a public endpoint (not yet repeated).`,
        fiveXx, fiveXx.map(e => e.public_url),
        `A single HTTP ${fiveXx[0].status} response was observed on a publicly reachable endpoint; not yet reproduced repeatedly.`,
        'Verify whether the error is transient before treating as available.',
        'LOW', 'LOW', 'LOW', 'MEDIUM', 'LOW', 'LOW'
      ));
    }

    // Documented incident (status page / PUBLIC_INCIDENT signal with incident language).
    const incidentSig = signals.find(s => s.type === 'PUBLIC_INCIDENT' || (s.type === 'STATUS_PAGE' && /outage|incident|degrad|interruption|disrupt/i.test(s.excerpt)));
    if (incidentSig) {
      found.push(this.deepFinding(
        'DOCUMENTED_INCIDENT', 'MEDIUM',
        `Publicly documented incident/degradation on ${incidentSig.source_url}.`,
        this.sigEvidence(incidentSig, src),
        this.signalUrls(incidentSig),
        `A status/observability page documents a past incident or degradation (${incidentSig.excerpt.slice(0, 120)}). This is a documented public record, not an active attack vector.`,
        'Corroborate against current behavior before acting on a past incident.',
        'MEDIUM', 'LOW', 'HIGH', 'MEDIUM', 'HIGH', 'MEDIUM'
      ));
    }

    // Documented engineering failure (article/blog with failure/incident language).
    const failureSig = signals.find(s =>
      (s.type === 'ENGINEERING_ARTICLE' || s.type === 'BLOG') &&
      /postmortem|post-mortem|root cause|outage|incident|failure|rollback|mitigation|degraded|bug|incident/i.test(s.excerpt)
    );
    if (failureSig) {
      found.push(this.deepFinding(
        'DOCUMENTED_ENGINEERING_FAILURE', 'LOW',
        `Engineering write-up documents a failure/incident on ${failureSig.source_url}.`,
        this.sigEvidence(failureSig, src),
        this.signalUrls(failureSig),
        `An engineering article documents a failure or postmortem (${failureSig.excerpt.slice(0, 120)}).`,
        'Treat as a resolved historical failure unless current recurrence is observed.',
        'LOW', 'LOW', 'LOW', 'LOW', 'LOW', 'LOW'
      ));
    }

    // Scaling constraint (architecture/scale discussion with capacity/rate-limit language).
    const scaleSig = signals.find(s =>
      (s.type === 'ARCHITECTURE_DISCUSSION' || s.type === 'ENGINEERING_ARTICLE') &&
      /scaling|sharded|partition|throughput|capacity|rate[- ]?limit|throttl|constraint|back.?pressure|queue|shard/i.test(s.excerpt)
    );
    if (scaleSig) {
      found.push(this.deepFinding(
        'DOCUMENTED_SCALING_CONSTRAINT', 'LOW',
        `Public documentation describes scaling/rate-limit behavior on ${scaleSig.source_url}.`,
        this.sigEvidence(scaleSig, src),
        this.signalUrls(scaleSig),
        `Public technical material describes scaling, rate limits, or capacity constraints (${scaleSig.excerpt.slice(0, 120)}).`,
        'These constraints are publicly documented product behavior, not a defect.',
        'LOW', 'LOW', 'LOW', 'LOW', 'LOW', 'LOW'
      ));
    }

    // Observed latency: requires STABILITY — not just a single spike.
    // A defensible latency finding requires:
    //   1. >= 3 observations with elevated latency (≥1000ms)
    //   2. EACH observation must be individually repeatable (slow samples
    //      reproduced within its own sample set) — this filters transient
    //      network variation vs. a REAL_SERVER_SIDE_PATTERN
    //   3. median latency ≥ 1500ms (bounded observation window)
    //   4. latency_samples present on each (proves reproducibility)
    // This distinguishes a real performance regression from one-off network jitter.
    const slowObs = src.filter(e =>
      (e.latency_ms || 0) > 0
      && e.repeatable                         // slow pattern reproduced across samples
      && e.latency_samples                    // samples exist (proof of repeat)
      && e.latency_samples.length >= 3        // at least 3 total samples
      && e.latency_ms! >= 1000                // this observation was slow
      && e.latency_samples.filter(s => s >= 1000).length >= 2  // majority slow
    );
    if (slowObs.length >= 3) {
      const latencies = slowObs.map(e => e.latency_ms!).sort((a, b) => a - b);
      const med = latencies[Math.floor(latencies.length / 2)];
      // Bounded observation window: median must be ≥ 1500ms to qualify.
      // A single slow observation with fast follow-ups is NOT stable.
      if (med >= 1500) {
        found.push(this.deepFinding(
          'OBSERVED_LATENCY', 'MEDIUM',
          `Stable slow latency detected (median ${med}ms, ≥3 observations, reproducible within each window).`,
          slowObs, slowObs.map(e => e.public_url),
          `Read-only requests to ${slowObs.length} public endpoint(s) returned with consistently elevated latency (median ${med}ms, each with ≥2 slow reproductions). This is an observed server-side performance pattern, not a single sample.`,
          'Re-measure latency at time of outreach; treat as a performance signal, not an outage.',
          'MEDIUM', 'MEDIUM', 'HIGH', 'MEDIUM', 'HIGH', 'MEDIUM'
        ));
      }
      // If slowObs exist but median < 1500ms, the slowness is not stable —
      // do NOT produce OBSERVED_LATENCY. Fall through to RESEARCH_MORE.
    }

    // Public exposure: repeatable unauthenticated behavior with explicit exposure language.
    const exposed = src.filter(e =>
      e.repeatable && e.tested_without_auth &&
      EXPOSURE_LANGUAGE_RE.test(e.observed_behavior)
    );
    if (exposed.length > 0) {
      found.push(this.deepFinding(
        'POSSIBLE_PUBLIC_EXPOSURE', 'MEDIUM',
        `${exposed.length} repeatable unauthenticated observation(s) with explicit exposure language.`,
        exposed, exposed.map(e => e.public_url),
        'A publicly reachable resource exhibited behavior explicitly described as accessible without authentication or exposing data.',
        'Verify the resource is intentionally public and within the documented product surface.',
        exposed.length >= 2 ? 'HIGH' : 'MEDIUM',
        exposed.length >= 2 ? 'MEDIUM' : 'LOW', 'HIGH', 'MEDIUM', 'HIGH', 'MEDIUM'
      ));
    }

    // R8: access issue — repeatable 401/403 on a public resource with explicit
    // denied/forbidden language. LOW/LOW confidence (weak signal; never alone
    // drives OUTREACH_READY — requires a corroborating defensible finding).
    const denied = src.filter(e =>
      e.repeatable && (e.status === 401 || e.status === 403) &&
      DENIAL_LANGUAGE_RE.test(e.observed_behavior)
    );
    if (denied.length > 0) {
      found.push(this.deepFinding(
        'POSSIBLE_ACCESS_ISSUE', 'LOW',
        `${denied.length} repeatable 401/403 observation(s) with explicit denial language.`,
        denied, denied.map(e => e.public_url),
        'A publicly reachable resource returned a repeatable 401/403 with explicit denial language. This is the expected auth boundary, not a bypass.',
        'Confirm the boundary is intentional and documented before outreach.',
        'LOW', 'LOW', 'LOW', 'MEDIUM', 'LOW', 'LOW'
      ));
    }

    // Pick the most defensible: highest severity, then most evidence.
    const SEV: Record<string, number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, UNKNOWN: 1 };
    // Every finding must carry concrete evidence IDs (never a signal-only claim).
    const valid = found.filter(f => f.evidence_ids.length > 0);
    valid.sort((a, b) => SEV[b.impact_severity] - SEV[a.impact_severity] || b.evidence_ids.length - a.evidence_ids.length);
    return valid.length ? valid[0] : null;
  }

  /**
   * Adversarial corroboration (Part E): resolve contradictions among
   * observations BEFORE they can be minted into a finding. When the same
   * public resource is observed both as exposed-without-auth and as an
   * auth-denied (401/403) boundary, the evidence is internally inconsistent —
   * the "corroboration" an exposure/access finding would lean on is actually
   * adversarial to its own claim. In that case we weaken to a LOW-confidence
   * CONFLICTING_EVIDENCE finding (which the build gate maps to RESEARCH_MORE).
   * Returns null when observations are consistent (no same-URL conflict).
   */
  private detectConflictingEvidence(src: Evidence[]): DeepFinding | null {
    // Bucket observations by normalized public URL so a contradiction is scoped
    // to the SAME resource (different resources may legitimately differ).
    const byUrl = new Map<string, Evidence[]>();
    for (const e of src) {
      const k = (e.public_url || '').replace(/\/$/, '');
      if (!k) continue;
      const bucket = byUrl.get(k) || [];
      bucket.push(e);
      byUrl.set(k, bucket);
    }

    for (const [, bucket] of byUrl) {
      if (bucket.length < 2) continue;
      const exposed = bucket.filter(e =>
        e.repeatable && e.tested_without_auth && EXPOSURE_LANGUAGE_RE.test(e.observed_behavior)
      );
      const denied = bucket.filter(e =>
        e.repeatable && (e.status === 401 || e.status === 403) && DENIAL_LANGUAGE_RE.test(e.observed_behavior)
      );
      if (exposed.length > 0 && denied.length > 0) {
        const both = [...exposed, ...denied];
        const url = both[0].public_url || 'the resource';
        return this.deepFinding(
          'CONFLICTING_EVIDENCE', 'LOW',
          `Conflicting public observations on ${url}: both unauthenticated-exposure and auth-denied (401/403) postures were recorded for the same resource.`,
          both,
          Array.from(new Set(both.map(e => e.public_url))),
          'Repeated observations of the same public resource contradict each other — one indicates unauthenticated exposure, another a 401/403 authentication boundary. The observation substrate is therefore unreliable for any exposure/access claim.',
          'Re-observe the resource under a controlled, identical request sequence to resolve the contradiction. Do not treat exposure or access claims as defensible until the conflict is resolved.',
          'LOW', 'LOW', 'LOW', 'LOW', 'LOW', 'LOW'
        );
      }
    }
    return null;
  }

  private deepFinding(
    type: FindingType, severity: SeverityLevel, basis: string,
    evidence: Evidence[], source_urls: string[], explanation: string, recommendation: string,
    confidence: 'LOW' | 'MEDIUM' | 'HIGH',
    evidenceS: StrengthLevel, reproS: StrengthLevel, sourceS: StrengthLevel, techS: StrengthLevel, ownerS: StrengthLevel
  ): DeepFinding {
    return {
      finding_type: type,
      impact_severity: severity,
      severity_basis: basis,
      evidence_ids: evidence.map(e => e.id),
      source_urls: Array.from(new Set(source_urls.filter(Boolean))),
      provenance: this.provenanceOfObs(evidence),
      confidence,
      strength: { evidence_strength: evidenceS, reproducibility: reproS, source_quality: sourceS, technical_specificity: techS, owner_confidence: ownerS },
      explanation,
      recommendation
    };
  }

  private provenanceOfObs(evidence: Evidence[]): EvidenceProvenance {
    if (evidence.some(e => e.evidence_origin === 'REAL_PUBLIC_OBSERVATION' || e.evidence_origin === 'MOCK_TEST')) return 'REAL_PUBLIC_OBSERVATION';
    if (evidence.some(e => e.evidence_origin === 'DOCUMENTED_SOURCE')) return 'DOCUMENTED_FACT';
    return 'REAL_PUBLIC_OBSERVATION';
  }

  private signalUrls(sig: DeepSignal): string[] {
    return sig.source_url ? [sig.source_url] : [];
  }

  private sigEvidence(sig: DeepSignal, observations: Evidence[]): Evidence[] {
    if (sig.related_evidence_ids && sig.related_evidence_ids.length) {
      // Enrich linked evidence records with the signal's actual excerpt text
      // so the claim provenance chain is directly auditable from the evidence
      // record (not an indirect HTTP 200 + signal.excerpt chain).
      return observations
        .filter(e => sig.related_evidence_ids!.includes(e.id))
        .map(e => DeepProspectBuilder.enrichEvidenceWithExcerpt(e, sig.excerpt));
    }
    // When no linked evidence IDs exist, match by URL and enrich.
    const byUrl = observations
      .filter(e => (e.public_url || '').replace(/\/$/, '') === (sig.source_url || '').replace(/\/$/, ''))
      .map(e => DeepProspectBuilder.enrichEvidenceWithExcerpt(e, sig.excerpt));
    // No fallback creation: a signal without real observation evidence does NOT
    // manufacture evidence IDs (no-fabrication rule). If empty, the finding's
    // evidence_ids will be [] and the valid filter will exclude it.
    return byUrl;
  }

  /** Enrich an existing evidence record with the signal's excerpt text so
   * the claimable observation is directly stored in the evidence record
   * (not scattered across HTTP 200 + signal.excerpt). */
  private static enrichEvidenceWithExcerpt(ev: Evidence, excerpt: string): Evidence {
    const text = (ev.evidence_text || ev.raw_observation || ev.observed_behavior || '').toString().replace(/\s+/g, ' ').trim();
    return {
      ...ev,
      observed_behavior: ev.observed_behavior === `HTTP ${ev.status || 200} observed`
        ? `${ev.observed_behavior} — ${excerpt}`
        : ev.observed_behavior,
      evidence_text: (text && text !== `HTTP ${ev.status || 200} observed`)
        ? text
        : excerpt,
    };
  }

  private persistArtifact(prospect: DeepProspect, company: string): string {
    const dir = path.join(this.artifactsBaseDir || process.cwd(), 'artifacts', 'intelligence', 'deep');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const p = path.join(dir, `${ts}-${company.replace(/\s+/g, '_')}.json`);
    const data = JSON.stringify(prospect, (k, v) => (k === 'case_ref' ? undefined : v), 2);
    if (this.saveArtifact) { this.saveArtifact(p, data); return p; }
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* reuse existing */ }
    fs.writeFileSync(p, data, 'utf8');
    return p;
  }
}

// failProspect types its local email object as DeepEmailDraft (imported above).
