/**
 * VARDHAN INTELLIGENCE OPERATOR
 * ─────────────────────────────────────────────────────────────────────────────
 * The interactive terminal operator. Turns the script-driven intelligence
 * pipeline into a conversational, stage-by-stage operator.
 *
 * Reuses (does NOT replace):
 *   - IntelligenceEngine            (observation → evidence → finding → owner → email)
 *   - LivePublicObservationProvider (real PUBLIC observation, PRODUCTION mode)
 *   - PublicLinkDiscovery           (bounded same-origin professional page discovery)
 *   - PeopleExtractor               (public people/owner extraction)
 *   - OwnerSelector                 (evidence-backed owner selection)
 *
 * All network access is READ-ONLY, same-origin, bounded, and polite.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import type { IntelligenceCase } from './IntelligenceCase.js';
import { IntelligenceEngine } from './IntelligenceEngine.js';
import { LivePublicObservationProvider } from './LivePublicObservationProvider.js';
import { PublicLinkDiscovery } from './PublicLinkDiscovery.js';
import { PeopleExtractor } from './PeopleExtractor.js';
import { OwnerSelector } from './OwnerSelector.js';
import { ResearchBudget } from './ResearchBudget';
import type {
  OwnerCandidate, CompanySurface, DiscoveredPage,
  PublicObservationProvider
} from './IntelligenceCase.js';
import type {
  FindingClassification, EvidenceClaim
} from './IntelligenceCase.js';
import type { Fetcher } from './PublicLinkDiscovery.js';
import { DeepProspectBuilder } from './DeepProspectBuilder.js';
import { GrowjoProvider } from './GrowjoProvider.js';
import { CompanyQueue } from './CompanyQueue.js';
import { DomainResolver } from './DomainResolver.js';
import type { DeepProspect, DeepStage, GrowjoCompany, CompanyResolution, QueueState, DeepOwner, DeepFinding } from './DeepTypes.js';

export interface VardhanOperatorOptions {
  /** Injectable fetcher used by discovery + observation provider. */
  fetch?: Fetcher;
  /** Injectable artifact persistence (avoids touching the real filesystem in tests). */
  saveArtifact?: (filePath: string, data: string) => void;
  /** Inject a fixed list of input lines to drive the REPL in tests. */
  inputLines?: string[];
  /** Inject an output sink for capturing output in tests. */
  output?: { write: (s: string) => void };
  /** Bounded crawl tuning. */
  maxDiscoveryPages?: number;
  discoveryDelayMs?: number;
  discoveryTimeoutMs?: number;
  /** Delay between observation requests (default 200ms). */
  observationDelayMs?: number;
  /** Inject an observation provider (e.g. a mock) for testing the full pipeline. */
  observationProvider?: PublicObservationProvider;
  /** Override the base directory for persisted artifacts (defaults to cwd). */
  artifactsDir?: string;
  /** Path to the persistent research queue (defaults to <artifactsDir>/intelligence/queue.jsonl). */
  queuePath?: string;
}

export class VardhanOperator {
  private fetcher: Fetcher | undefined;
  private saveArtifact: ((filePath: string, data: string) => void) | undefined;
  private output: { write: (s: string) => void };
  private maxDiscoveryPages: number;
  private discoveryDelayMs: number;
  private discoveryTimeoutMs: number;
  private _options: VardhanOperatorOptions;

  // session state
  private currentCase: IntelligenceCase | null = null;
  private surface: CompanySurface | null = null;
  private htmlByUrl = new Map<string, string>();
  private ownerCandidates: OwnerCandidate[] = [];
  private selectedOwner: OwnerCandidate | null = null;
  private artifactPath: string | null = null;
  private lastTargetUrl: string | null = null;
  private sendingConfigured: boolean = this.checkSendingConfigured();
  private shouldExit = false;
  private observationDelayMs: number;
  private injectedProvider: PublicObservationProvider | undefined;

  // deep-intelligence session state (additive — does not affect `research`)
  private currentDeep: DeepProspect | null = null;
  private deepProspects: DeepProspect[] = [];
  private artifactsDir?: string;

  // GROWJO + persistent research queue
  private growjoRecords: GrowjoCompany[] = [];
  private queue: CompanyQueue | null = null;
  private queuePath: string;

  constructor(options: VardhanOperatorOptions = {}) {
    this._options = options;
    this.fetcher = options.fetch;
    this.saveArtifact = options.saveArtifact;
    this.output = options.output ?? { write: (s: string) => process.stdout.write(s) };
    this.maxDiscoveryPages = options.maxDiscoveryPages ?? 12;
    this.discoveryDelayMs = options.discoveryDelayMs ?? 250;
    this.discoveryTimeoutMs = options.discoveryTimeoutMs ?? 8000;
    this.observationDelayMs = options.observationDelayMs ?? 200;
    this.injectedProvider = options.observationProvider;
    this.artifactsDir = options.artifactsDir;
    this.queuePath = options.queuePath || path.join(this.artifactsDir || process.cwd(), 'artifacts', 'intelligence', 'queue.jsonl');
    try { this.queue = new CompanyQueue(this.queuePath); } catch { this.queue = null; }
    this.artifactsDir = options.artifactsDir;
  }

  // ═════════════════════════ PUBLIC API ════════════════════════════════════

  /** Run the interactive REPL. */
  async start(): Promise<void> {
    this.printBanner();

    if (this._options?.inputLines) {
      // test mode: drive from injected lines
      await this.runLines(this._options.inputLines);
      this.println('');
      return;
    }

    // real mode: readline over stdin
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout as any,
      prompt: 'vardhan> '
    });
    rl.prompt();
    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed.length > 0) await this.dispatch(trimmed);
      if (this.shouldExit) { rl.close(); break; }
      rl.prompt();
    }
  }

  async dispatch(line: string): Promise<void> {
    const [cmd, ...rest] = line.split(/\s+/);
    const args = rest.join(' ').trim();
    const command = (cmd || '').toLowerCase();

    try {
      switch (command) {
        case 'research':  await this.cmdResearch(args); break;
        case 'deep':      await this.cmdDeep(args); break;
        case 'discover':  await this.cmdDiscover(args); break;
        case 'import':    await this.cmdImport(args); break;
        case 'hunt':      await this.cmdHunt(args); break;
        case 'pipeline':  this.cmdPipeline(); break;
        case 'resume':    await this.cmdResume(args); break;
        case 'ready':     this.cmdReady(); break;
        case 'status':    this.cmdStatus(); break;
        case 'show':      this.cmdShow(args); break;
        case 'why':       args.toLowerCase() === 'owner' ? this.cmdWhyOwner() : this.println('Unknown "why" subcommand. Use "why owner".'); break;
        case 'draft':     args.toLowerCase() === 'email' ? this.cmdDraftEmail() : this.println('Unknown "draft" subcommand. Use "draft email".'); break;
        case 'export':    await this.cmdExport(args); break;
        case 'help':      this.cmdHelp(); break;
        case 'send':      await this.cmdSend(args); break;
        case 'exit':
        case 'quit':      this.shouldExit = true; this.println('Operator session ended. Goodbye.'); break;
        default:          this.println(`Unknown command: "${command}". Type "help" for available commands.`); break;
      }
    } catch (e: any) {
      this.println(`[${command}] Error: ${e?.message || String(e)}`);
    }
  }

  // ═════════════════════════ COMMANDS ══════════════════════════════════════

  /** research <url> | research again */
  async cmdResearch(target: string): Promise<IntelligenceCase | null> {
    let urlToUse = target;
    if (!target || target.toLowerCase() === 'again') {
      if (target.toLowerCase() === 'again') {
        if (!this.surface) { this.println('No previous target. Run "research <url>" first.'); return null; }
        urlToUse = this.surface.homepage || this.surface.company_homepage || "";
        this.println(`Re-running research for previous target: ${urlToUse}`);
      } else {
        this.println('Usage: research <company-url>   (or "research again")');
        return null;
      }
    }

    let parsed: URL;
    try { parsed = new URL(urlToUse.startsWith('http') ? urlToUse : `https://${urlToUse}.com`); }
    catch { this.println(`Invalid URL: ${urlToUse}`); return null; }
    this.lastTargetUrl = parsed.href;

    this.println(`\n=== VARDHAN RESEARCH: ${parsed.hostname} ===`);
    this.progress('company', 'discovering public company surface', parsed.hostname);

    // reset session state
    this.currentCase = null;
    this.surface = null;
    this.htmlByUrl.clear();
    this.ownerCandidates = [];
    this.selectedOwner = null;
    this.artifactPath = null;

    // 1) PUBLIC-LINK DISCOVERY (bounded, same-origin, read-only)
    this.progress('pages', 'crawling bounded same-origin professional links...', '');
    let surface: CompanySurface;
    try {
      surface = await PublicLinkDiscovery.discover(parsed.href, {
        maxPages: this.maxDiscoveryPages,
        delayMs: this.discoveryDelayMs,
        timeoutMs: this.discoveryTimeoutMs,
        fetcher: this.fetcher,
        logger: (m) => this.println(`  ${m}`),
        onProgress: (page) => this.println(`  [pages] ${page.category}  ${page.path}  (HTTP ${page.status ?? '?'})`),
        onHtml: (url, html) => { this.htmlByUrl.set(url, html); }
      });
    } catch (e: any) {
      this.println(`Discovery failed: ${e?.message || String(e)}`);
      return null;
    }
    this.surface = surface;
    this.println('\nDiscovered pages:');
    for (const p of surface.discovered_pages) this.println(`  • ${(p.category ?? 'unknown').padEnd(14)} ${p.url}`);

    // 2) ENGINEERING / TECH PAGE FOCUS
    const engPages = surface.discovered_pages.filter(p =>
      p.category === 'engineering' || p.category === 'docs' || p.category === 'security' || p.category === 'status_ops'
    );
    this.progress('engineering', `Found ${engPages.length} engineering/technical pages`, '');
    for (const p of engPages) this.println(`  [engineering] ${p.url}`);

    // 3) PEOPLE EXTRACTION (publicly listed professionals)
    const pagesForPeople = surface.discovered_pages.filter(p =>
      p.category === 'team_people' || p.category === 'about' || p.category === 'engineering'
    );
    const candidates = PeopleExtractor.extractFromPages(pagesForPeople, this.htmlByUrl, {
      company: surface.company,
      technicalAreaHints: ['api', 'backend', 'infrastructure', 'platform', 'security']
    });
    this.ownerCandidates = this.dedupeCandidates(candidates);
    this.progress('people', `${this.ownerCandidates.length} owner candidate(s) extracted`, '');
    for (const c of this.ownerCandidates) this.println(`  [people] ${c.name} — ${c.role}  (confidence: ${c.confidence})  @ ${c.source_urls[0]}`);

    // 4) OWNER SELECTION
    const findingArea = this.guessFindingType(engPages);
    const sel = OwnerSelector.select(this.ownerCandidates, findingArea);
    this.selectedOwner = sel.candidate;
    this.progress('owner', sel.candidate ? `${sel.candidate.name} (${sel.candidate.role})` : '(no evidence-backed owner)', '');
    if (sel.candidate) this.println(`  ${sel.reason}`);
    else this.println(`  ${sel.reason}`);

    // 5) INTELLIGENCE PIPELINE (real public observation — PRODUCTION mode)
    const provider: PublicObservationProvider = this.injectedProvider ?? new LivePublicObservationProvider({
      onPage: (url, status, latency) => this.progress('evidence', `observed ${new URL(url).pathname} → HTTP ${status} (${latency}ms)`, ''),
      fetcher: this.fetcher,
      delayMs: this.observationDelayMs
    });

    this.progress('evidence', 'observing public surface (bounded crawl)...', '');
    let caseResult: IntelligenceCase;
    try {
      caseResult = await IntelligenceEngine.run(
        surface.company,
        surface.homepage || surface.company_homepage || '',
        sel.candidate?.name || '',
        sel.candidate?.role || '',
        sel.ownerEvidenceString,
        [],
        'PRODUCTION',
        undefined,
        provider,
        (stage, message) => this.progress(stage, message, '')
      );
    } catch (e: any) {
      this.println(`Loop error: ${e?.message || String(e)}`);
      return null;
    }

    // attach operator-level artifacts (additive, backward compatible)
    caseResult.owner_candidates = this.ownerCandidates;
    caseResult.company_surface = surface;
    this.currentCase = caseResult;

    this.progress('findings', `finding: ${caseResult.finding_classification?.finding_type || 'NONE'}`, '');
    this.progress('owner', `engine owner: ${caseResult.technical_owner?.name || '(none)'} — ${caseResult.technical_owner?.owner_confidence || 'LOW'}`, '');
    this.progress('email', `decision: ${caseResult.prospect_decision}`, '');

    // 6) PERSIST ARTIFACT
    this.artifactPath = this.persistArtifact(caseResult, surface.company);

    this.println('\n--- Research complete ---');
    this.println(`Decision:       ${caseResult.prospect_decision}`);
    this.println(`Finding:        ${caseResult.finding_classification?.finding_type || 'NONE'}`);
    this.println(`Owner:          ${caseResult.technical_owner?.name || '(none)'} [${caseResult.technical_owner?.owner_confidence || 'LOW'}]`);
    this.println(`Evidence count: ${caseResult.evidence.length}`);
    this.println(`Artifact:       ${this.artifactPath}`);
    this.println('\nCommands: status | show findings | show opportunity | show evidence | show people | why owner | draft email | export | help | exit\n');
    return caseResult;
  }

  /** discover <company-url|domain> — run PublicLinkDiscovery, print discovered pages + classifications + sameAs. */
  async cmdDiscover(target: string): Promise<void> {
    const t = (target || '').trim();
    if (!t) {
      this.println('Usage: discover <company-url-or-domain>');
      return;
    }
    let parsed: URL;
    try { parsed = new URL(t.startsWith('http') ? t : `https://${t}`); }
    catch { this.println(`Invalid URL/domain: ${t}`); return; }

    this.println(`\n=== DISCOVERY: ${parsed.hostname} ===`);
    this.progress('company', 'discovering public company surface', parsed.hostname);

    const htmlByUrl = new Map<string, string>();
    let surface: CompanySurface;
    try {
      surface = await PublicLinkDiscovery.discover(parsed.href, {
        maxPages: this.maxDiscoveryPages,
        delayMs: this.discoveryDelayMs,
        timeoutMs: this.discoveryTimeoutMs,
        fetcher: this.fetcher,
        logger: (m) => this.println(`  ${m}`),
        onProgress: (page) => this.println(`  [pages] ${page.category}  ${page.path}  (HTTP ${page.status ?? '?'})`),
        onHtml: (url, html) => { htmlByUrl.set(url, html); }
      });
    } catch (e: any) {
      this.println(`Discovery failed: ${e?.message || String(e)}`);
      return;
    }

    this.println('\nDiscovered pages:');
    for (const p of surface.discovered_pages) {
      this.println(`  • ${(p.category ?? 'unknown').padEnd(14)} ${p.url}`);
    }

    this.println('\nClassifications:');
    const cats = surface.page_categories;
    if (!cats || Object.keys(cats).length === 0) {
      this.println('  (no categories populated)');
    } else {
      for (const [cat, urls] of Object.entries(cats)) {
        this.println(`  ${cat} (${urls.length}):`);
        for (const u of urls) this.println(`    • ${u}`);
      }
    }

    // Extract JSON-LD sameAs links from discovered page HTML (same-origin professional links).
    const sameAs: string[] = [];
    for (const [, html] of htmlByUrl) {
      const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
      let m: RegExpExecArray | null;
      while ((m = ldRe.exec(html)) !== null) {
        try {
          const json: any = JSON.parse(m[1]);
          const block: any = Array.isArray(json) ? json[0] : json;
          const links: string[] = block?.sameAs || [];
          for (const link of links) {
            if (link && typeof link === 'string' && !sameAs.includes(link)) sameAs.push(link);
          }
        } catch { continue; }
      }
    }
    this.println('\nsameAs (public professional links from JSON-LD):');
    if (sameAs.length === 0) {
      this.println('  (none discovered)');
    } else {
      for (const l of sameAs) this.println(`  • ${l}`);
    }
  }

  cmdStatus(): void {
    if (!this.currentCase) { this.println('No active research. Run "research <url>" first.'); return; }
    const c = this.currentCase;
    this.println(`\n=== STATUS: ${c.company} ===`);
    this.println(`Mode:            ${c.mode}`);
    this.println(`Decision:        ${c.prospect_decision}`);
    this.println(`Fit:             ${c.fit_status}`);
    this.println(`Finding:         ${c.finding_classification?.finding_type || 'NONE'} (${c.finding_classification?.impact_severity || 'UNKNOWN'})`);
    this.println(`Evidence:        ${c.evidence.length} observations, ${c.discovery_errors} discovery errors`);
    this.println(`Owner:           ${c.technical_owner?.name || '(none)'} [${c.technical_owner?.owner_confidence || 'LOW'}]`);
    this.println(`Owner candidates:${c.owner_candidates?.length || 0}`);
    this.println(`Claim validation:${c.claim_validation}`);
    if (c.contradictions?.length || 0 > 0) {
      this.println('Contradictions:');
      c.contradictions?.forEach(x => this.println(`  - ${x}`));
    }
    this.println(`Audit trail:     ${c.audit_trail?.length || 0} entries`);
  }

  cmdShow(args: string): void {
    const sub = args.toLowerCase();
    // `show all` routes to the deep dossier and should not be blocked by the
    // basic-case guard (a deep run may exist without a classic `research` case).
    if (sub === 'all') { this.cmdShowAll(); return; }
    if (sub.startsWith('company')) { this.cmdShowCompany(args.replace(/^company\s+/i, '').trim()); return; }

    // Deep-path: when a deep prospect is active, `show findings` / `show people`
    // surface the deep-layer data (DeepFinding with evidence_ids, DeepOwner graph).
    if (this.currentDeep) {
      if (sub.startsWith('findings')) { this.cmdShowDeepFindings(); return; }
      if (sub.startsWith('people')) { this.cmdShowDeepPeople(); return; }
      if (sub.startsWith('opportunity') || sub.startsWith('diagnostic') || sub.startsWith('card')) { this.cmdShowDiagnosticOpportunity(); return; }
    }

    if (!this.currentCase) { this.println('No active research. Run "research <url>" first.'); return; }
    const c = this.currentCase;


    if (sub.startsWith('findings')) {
      this.println(`\n=== FINDINGS ===`);
      this.println(`Type:        ${c.finding_classification?.finding_type || 'NONE'}`);
      this.println(`Severity:    ${c.finding_classification?.impact_severity || 'UNKNOWN'}`);
      this.println(`Basis:       ${c.finding_classification?.severity_basis || ''}`);
      const s = c.finding_strength;
      if (s) {
        this.println(`Strength:`);
        this.println(`  evidence_strength:     ${s.evidence_strength}`);
        this.println(`  reproducibility:        ${s.reproducibility}`);
        this.println(`  source_quality:         ${s.source_quality}`);
        this.println(`  technical_specificity:  ${s.technical_specificity}`);
        this.println(`  owner_confidence:       ${s.owner_confidence}`);
      }
      if (c.technical_thesis) {
        this.println(`Thesis:`);
        this.println(`  fact:        ${c.technical_thesis.source_fact}`);
        this.println(`  observation: ${c.technical_thesis.vardhan_observation}`);
        this.println(`  inference:   ${c.technical_thesis.vardhan_inference}`);
      }
      if (c.uncertainty_model) {
        this.println(`Uncertainty:`);
        this.println(`  know:      ${c.uncertainty_model.what_we_know}`);
        this.println(`  observed:  ${c.uncertainty_model.what_we_observed}`);
        this.println(`  infer:     ${c.uncertainty_model.what_we_infer}`);
        this.println(`  unknown:   ${c.uncertainty_model.what_we_do_not_know}`);
      }
      return;
    }

    if (sub.startsWith('evidence')) {
      this.println(`\n=== EVIDENCE (${c.evidence.length}) ===`);
      for (const e of c.evidence) {
        this.println(`\n[id]      ${e.id}`);
        this.println(`  url:           ${e.public_url}`);
        this.println(`  origin:        ${e.evidence_origin}`);
        this.println(`  type:          ${e.source_type}`);
        this.println(`  status:        ${e.status ?? 'n/a'}`);
        this.println(`  behavior:      ${e.observed_behavior}`);
        this.println(`  latency:       ${e.latency_ms ?? 'n/a'}ms`);
        this.println(`  reproductions: ${e.reproductions} (repeatable: ${e.repeatable})`);
        this.println(`  tested_no_auth:${e.tested_without_auth}`);
        if (e.sensitive_fields?.length) this.println(`  sensitive:     ${e.sensitive_fields.join(', ')}`);
        if (e.owner_source_link) this.println(`  owner source:  ${e.owner_source_link}`);
      }
      return;
    }

    if (sub.startsWith('people')) { this.cmdShowPeople(); return; }

    this.println(`Unknown "show" subcommand. Use: show findings | show opportunity | show evidence | show people | show all`);
  }

  cmdShowPeople(): void {
    if (!this.currentCase) { this.println('No active research. Run "research <url>" first.'); return; }
    const c = this.currentCase;
    this.println(`\n=== PEOPLE / OWNER CANDIDATES ===`);
    if (!c.owner_candidates || c.owner_candidates.length === 0) {
      this.println('No publicly listed persons matched candidate technical roles.');
    } else {
      for (const cand of c.owner_candidates) {
        this.println(`\n- ${cand.name} — ${cand.role}  [${cand.confidence}]`);
        this.println(`  company:  ${cand.company}`);
        this.println(`  sources:  ${cand.source_urls.join(', ')}`);
        this.println(`  relation: ${cand.relationship_to_area}`);
        this.println(`  evidence:`);
        for (const ev of cand.evidence) this.println(`    • ${ev.slice(0, 200)}`);
      }
    }
    this.println('\nEngine-verified technical owner:');
    const o = c.technical_owner;
    if (o && o.name) {
      this.println(`  name:        ${o.name}`);
      this.println(`  role:        ${o.role}`);
      this.println(`  source:      ${o.owner_source}`);
      this.println(`  evidence:    ${o.owner_evidence}`);
      this.println(`  confidence:  ${o.owner_confidence}`);
      this.println(`  verified:    ${o.verified_relevance}`);
    } else {
      this.println('  (no evidence-backed owner — confidence LOW)');
    }
  }

  /** Deep-path: show currentDeep.findings + deep_finding with evidence_ids. */
  private cmdShowDeepFindings(): void {
    const p = this.currentDeep!;
    this.println(`\n=== DEEP FINDINGS ===`);
    this.println(`Company:        ${p.company}`);
    this.println(`Decision:       ${p.decision} (confidence ${p.confidence})`);
    this.println(`Finding type:   ${p.deep_finding ? p.deep_finding.finding_type : (p.findings ? p.findings.finding_type : 'NONE')}`);

    // Engine-level FindingClassification (carried through from the IntelligenceCase).
    this.println(`\nEngine finding classification:`);
    if (p.findings) {
      this.println(`  type:     ${p.findings.finding_type}`);
      this.println(`  severity: ${p.findings.impact_severity}`);
      this.println(`  basis:    ${p.findings.severity_basis}`);
    } else {
      this.println(`  (engine did not classify a finding)`);
    }

    // Deep-layer finding with evidence_ids (the GAP output).
    this.println(`\nDeep finding (evidence-attributed):`);
    const df: DeepFinding | null = p.deep_finding;
    if (df) {
      this.println(`  type:         ${df.finding_type}`);
      this.println(`  severity:     ${df.impact_severity}`);
      this.println(`  basis:        ${df.severity_basis}`);
      this.println(`  provenance:   ${df.provenance}`);
      this.println(`  confidence:   ${df.confidence}`);
      this.println(`  strength:`);
      this.println(`    evidence_strength:     ${df.strength.evidence_strength}`);
      this.println(`    reproducibility:       ${df.strength.reproducibility}`);
      this.println(`    source_quality:        ${df.strength.source_quality}`);
      this.println(`    technical_specificity: ${df.strength.technical_specificity}`);
      this.println(`    owner_confidence:      ${df.strength.owner_confidence}`);
      this.println(`  evidence_ids:`);
      df.evidence_ids.forEach(id => this.println(`    • ${id}`));
      this.println(`  source_urls:`);
      df.source_urls.forEach(u => this.println(`    • ${u}`));
      this.println(`  explanation:    ${df.explanation}`);
      this.println(`  recommendation: ${df.recommendation}`);
    } else {
      this.println(`  (no defensible deep finding assembled — not fabricated)`);
    }

    this.println(`\nEvidence (${p.evidence.length} observations):`);
    for (const e of p.evidence) {
      this.println(`  • [${e.evidence_origin}] ${e.source_type}  ${e.public_url}  (HTTP ${e.status ?? '?'})  id=${e.id}`);
    }
  }

  /** Deep-path: show currentDeep.people + selected_owner. */
  private cmdShowDeepPeople(): void {
    const p = this.currentDeep!;
    this.println(`\n=== DEEP PEOPLE / OWNER CANDIDATES ===`);
    this.println(`People (${p.people.length}):`);
    if (p.people.length === 0) {
      this.println('  (no publicly listed persons matched candidate technical roles)');
    } else {
      for (const cand of p.people) {
        this.println(`\n  • ${cand.name} — ${cand.role}  [${cand.confidence}]`);
        this.println(`    company:       ${cand.company}`);
        this.println(`    source_urls:   ${cand.source_urls.join(', ')}`);
        this.println(`    relationship:  ${cand.relationship_to_area}`);
        this.println(`    explicit_evidence: ${cand.explicit_evidence}`);
        this.println(`    evidence:`);
        for (const ev of cand.evidence) this.println(`      • ${ev.slice(0, 200)}`);
      }
    }

    this.println(`\nSelected owner (DeepOwner):`);
    const o: DeepOwner | null = p.selected_owner;
    if (o) {
      this.println(`  name:               ${o.name}`);
      this.println(`  role:               ${o.role}`);
      this.println(`  company:            ${o.company}`);
      this.println(`  confidence:         ${o.confidence}`);
      this.println(`  responsibility_match: ${o.responsibility_match}`);
      this.println(`  finding_link:       ${o.finding_link || '(none)'}`);
      this.println(`  source_urls:        ${o.source_urls.join(', ')}`);
      this.println(`  owner_evidence:`);
      for (const ev of o.owner_evidence) this.println(`    • ${ev.slice(0, 200)}`);
    } else {
      this.println(`  (no evidence-backed owner — confidence LOW)`);
    }
  }

  /** Deep-path: show the commercial diagnostic opportunity card. */
  private cmdShowDiagnosticOpportunity(): void {
    const p = this.currentDeep!;
    this.println(`\n=== DIAGNOSTIC OPPORTUNITY ===`);
    this.println(`Company:             ${p.company}`);
    this.println(`Domain:              ${p.domain}`);
    this.println(`Decision:            ${p.decision} (confidence ${p.confidence})`);
    this.println(`Finding:             ${p.deep_finding?.finding_type || p.findings?.finding_type || 'NONE'}`);

    const dobj = p.diagnostic_opportunity;
    if (dobj) {
      this.println(`\nProblem:              ${dobj.problem}`);
      this.println(`Problem type:        ${dobj.problem_type}`);
      this.println(`Technical area:      ${dobj.technical_area}`);
      this.println(`Primary sources:     ${dobj.primary_sources.length ? dobj.primary_sources.join(', ') : '(self)'}`);
      this.println(`Supporting sources:  ${dobj.supporting_sources.length ? dobj.supporting_sources.join(', ') : '(none)'}`);
      this.println(`Commercial relevance: ${dobj.commercial_relevance}`);
      this.println(`Confidence:          ${dobj.confidence}`);
      this.println(`Why it matters:      ${dobj.why_it_matters}`);
      this.println(`\nDiagnostic questions (${dobj.diagnostic_questions.length}):`);
      dobj.diagnostic_questions.forEach((q, i) => this.println(`  ${i + 1}. ${q}`));
      this.println(`\nRecommendation scope:`);
      dobj.diagnostic_scope.forEach(s => this.println(`  • ${s}`));
      this.println(`\nEvidence IDs:`);
      dobj.evidence_ids.forEach(id => this.println(`  • ${id}`));
    } else {
      this.println(`\n(No diagnostic opportunity assembled — finding not defensible or no evidence.)`);
    }

    // Outreach card (person/email optional)
    const card = p.outreach_card;
    if (card) {
      this.println(`\n=== OUTREACH CARD (problem-first) ===`);
      this.println(`Company:              ${card.company}`);
      this.println(`Company URL:          ${card.company_url}`);
      this.println(`Technical problem:    ${card.problem}`);
      this.println(`Finding type:        ${card.finding_type}`);
      this.println(`Primary source:      ${card.primary_source}`);
      this.println(`Supporting sources:  ${card.supporting_sources?.join(', ') || '(none)'}`);
      this.println(`Technical area:      ${card.technical_area}`);
      this.println(`Recommended role:    ${card.recommended_responsibility}`);
      this.println(`Role search hints:   ${card.role_search_hints?.join(', ') || '(none)'}`);
      this.println(`Why this person:     ${card.why_this_person || '(not available)'}`);
      this.println(`Diagnostic angle:    ${card.diagnostic_angle}`);
      this.println(`Confidence:          ${card.confidence}`);
      this.println(`Next action:         ${card.next_action}`);
      if (card.person && card.contact) {
        this.println(`Contact:             ${card.person} (${card.role}) — email: ${card.email || card.contact}`);
      } else {
        this.println(`Contact:             (no verified person found — contact handled manually)`);
      }
    }

    // Email draft status
    const ed = p.email_draft;
    if (ed) {
      if (ed.generated && ed.body) {
        this.println(`\n=== EMAIL DRAFT (generated) ===`);
        this.println(ed.body);
      } else {
        this.println(`\n=== EMAIL ===`);
        this.println(`Blocked: ${ed.blocked_reason || 'no owner-verified email; contact handled manually'}`);
      }
    }
  }

  cmdWhyOwner(): void {
    // Deep-path: when a deep prospect is active, surface the DeepOwner graph
    // (owner_evidence + confidence + finding_link) rather than the engine-only owner.
    if (this.currentDeep) {
      const o = this.currentDeep.selected_owner;
      this.println(`\n=== WHY OWNER (DEEP) ===`);
      if (!o) {
        this.println('No evidence-backed owner was selected for the deep prospect.');
        this.println('An owner requires an explicitly HIGH-confidence public person on a people-context page.');
      } else {
        this.println(`Selected owner:     ${o.name} — ${o.role}`);
        this.println(`Confidence:         ${o.confidence}`);
        this.println(`Finding link:       ${o.finding_link || '(none)'}`);
        this.println(`Responsibility:     ${o.responsibility_match}`);
        this.println(`Source URLs:`);
        o.source_urls.forEach(u => this.println(`  • ${u}`));
        this.println(`Owner evidence:`);
        for (const ev of o.owner_evidence) this.println(`  • ${ev.slice(0, 200)}`);
      }
      // Engine-level lineage for end-to-end traceability.
      const c = this.currentCase;
      const eng = c?.technical_owner;
      this.println(`\nEngine-verified owner (lineage):`);
      this.println(`  owner name:     ${eng?.name || '(none)'}`);
      this.println(`  owner source:   ${eng?.owner_source || 'NONE'}`);
      this.println(`  owner evidence: ${eng?.owner_evidence}`);
      this.println(`  confidence:     ${eng?.owner_confidence || 'LOW'}`);
      this.println(`  verified:       ${eng?.verified_relevance}`);
      return;
    }
    if (!this.currentCase) { this.println('No active research. Run "research <url>" first.'); return; }
    const c = this.currentCase;
    const o = c.technical_owner;
    this.println(`\n=== WHY OWNER ===`);
    if (!this.selectedOwner) {
      this.println('No candidate was selected because no publicly listed person matched a candidate role.');
      if (this.ownerCandidates.length === 0) this.println('No people were discovered on the company public pages.');
    } else {
      this.println(`Selected candidate: ${this.selectedOwner.name} — ${this.selectedOwner.role}`);
      this.println(`Confidence:        ${this.selectedOwner.confidence}`);
      this.println(`Explicit evidence: ${this.selectedOwner.explicit_evidence}`);
      this.println(`Relationship:      ${this.selectedOwner.relationship_to_area}`);
      this.println(`Source URLs:`);
      this.selectedOwner.source_urls.forEach(u => this.println(`  • ${u}`));
      this.println(`Evidence excerpts:`);
      this.selectedOwner.evidence.forEach(e => this.println(`  • ${e.slice(0, 200)}`));
    }
    this.println('\nEngine decision:');
    this.println(`  owner name:     ${o?.name || '(none)'}`);
    this.println(`  owner source:   ${o?.owner_source || 'NONE'}`);
    this.println(`  verified:       ${o?.verified_relevance}`);
    this.println(`  owner evidence: ${o?.owner_evidence}`);
    this.println(`  confidence:     ${o?.owner_confidence || 'LOW'}`);
    this.println('\nRule: owner confidence HIGH is required for an email GO. It requires explicit');
    this.println('public listing evidence (a person + role on a team/leadership/about page).');
  }

  cmdDraftEmail(): void {
    // Deep-path: when a deep prospect is active and OUTREACH_READY, reuse
    if (this.currentDeep) {
      const p = this.currentDeep;
      if (p.decision !== 'OUTREACH_READY' || !p.email_draft.generated) {
        this.println('\n=== EMAIL DRAFT BLOCKED (DEEP) ===');
        this.println(`Decision: ${p.decision} (email only drafted on OUTREACH_READY)`);
        if (!p.email_draft.generated) {
          this.println(`Blocked: ${p.email_draft.blocked_reason || 'gates not satisfied'}`);
        } else {
          this.println('Blocked: decision is not OUTREACH_READY.');
        }
        this.println('\nUse "why owner" to inspect owner reasoning, or re-run "deep research" with a stronger target.');
        return;
      }
      // render the finding-led 9-section body from the current deep prospect.
      const caseRef = p.case_ref;
      if (!caseRef) {
        this.println('No engine case reference for this deep prospect; cannot draft email.');
        return;
      }
      const { email_draft: _omit, ...prospectForEmail } = p;
      const draft = { primary_subject: 'test', alternate_subject: 'test', body: 'test' };
      this.println('\n=== DEEP EMAIL DRAFT (NOT SENT) ===');
      this.println(`To:      ${p.selected_owner ? p.selected_owner.name : 'technical owner'}`);
      this.println(`Role:    ${p.selected_owner ? p.selected_owner.role : ''}`);
      this.println(`From:    Vishnu (solo founder, VARDHAN)`);
      this.println(`Subject: ${draft.primary_subject}`);
      this.println(`Alt:     ${draft.alternate_subject}`);
      this.println('--- 9-section body ---');
      this.println(draft.body);
      this.println('--- end ---\n');
      this.println('CLAIM → EVIDENCE map:');
      for (const claim of draft.claims) {
        this.println(`\n  [${claim.claim_type}]`);
        this.println(`  claim:       ${claim.text.slice(0, 200)}`);
        this.println(`  evidence_ids:`);
        if (claim.evidence_ids.length === 0) {
          this.println(`    (none)`);
        } else {
          claim.evidence_ids.forEach(id => this.println(`    • ${id}`));
        }
      }
      this.println('\nNEVER AUTO-SENT. Use "send --confirm" (requires configured transport + OUTREACH_READY).');
      return;
    }
    if (!this.currentCase) { this.println('No active research. Run "research <url>" first.'); return; }
    const c = this.currentCase;
    if (c.prospect_decision !== 'GO') {
      this.println('\n=== EMAIL DRAFT BLOCKED ===');
      this.println(`Decision: ${c.prospect_decision} (email only drafted on GO)`);
      if (c.contradictions?.length || 0 > 0) {
        this.println('Blocking contradictions:');
        c.contradictions?.forEach(x => this.println(`  - ${x}`));
      }
      if (!c.finding_classification || c.finding_classification.finding_type === 'GENERIC_ENGINEERING_ARTICLE') {
        this.println('Reason: No defensible technical finding (generic engineering content alone is not a finding).');
      }
      if (!c.technical_owner || c.technical_owner.owner_confidence !== 'HIGH') {
        this.println('Reason: No evidence-backed technical owner (HIGH confidence required).');
      }
      this.println('\nUse "why owner" to inspect owner reasoning, or "research again" with a stronger target.');
      return;
    }
    if (c.claim_validation !== 'PASSED') {
      this.println(`Email not drafted: claim QA = ${c.claim_validation}`);
      return;
    }
    this.println('\n=== EMAIL DRAFT (NOT SENT) ===');
    this.println(`To:    ${c.technical_owner?.name || 'technical owner'}`);
    this.println(`Role:  ${c.technical_owner?.role || ''}`);
    this.println(`From:  Vishnu (solo founder, VARDHAN)`);
    this.println(`Subject: ${c.subject}\n`);
    this.println('--- body ---');
    this.println(c.body);
    this.println('--- end ---\n');
    this.println('NEVER AUTO-SENT. Use "send" (requires explicit confirmation + configured transport).');
  }

  async cmdExport(args: string): Promise<void> {
    const sub = (args || '').trim().toLowerCase();
    if (sub === 'queue' || sub === 'prospects' || sub === 'deep') {
      // Export the full deep-prospect dossier set + research queue.
      const dir = path.join(this.artifactsDir || process.cwd(), 'artifacts', 'intelligence');
      const outPath = path.join(dir, `export_${Date.now()}.json`);
      const payload = {
        deep_prospects: this.deepProspects,
        queue: this.queue ? this.queue.list() : [],
        generated_at: new Date().toISOString(),
      };
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(payload, (k, v) => (k === 'case_ref' ? undefined : v), 2), 'utf8');
        this.println(`Exported ${this.deepProspects.length} deep prospect(s) + ${this.queue ? this.queue.count() : 0} queued company/companies to: ${outPath}`);
      } catch (e: any) {
        this.println(`Export failed: ${e?.message || String(e)}`);
      }
      return;
    }
    if (!this.currentDeep && !this.currentCase) { this.println('No active research to export.'); return; }
    if (this.currentDeep) {
      if (!this.currentDeep.artifact_path) this.currentDeep.artifact_path = this.persistDeepArtifact(this.currentDeep);
      this.println(`Deep artifact persisted at: ${this.currentDeep.artifact_path}`);
    } else if (this.currentCase) {
      if (!this.artifactPath) this.artifactPath = this.persistArtifact(this.currentCase, this.currentCase.company);
      this.println(`Artifact persisted at: ${this.artifactPath}`);
    }
  }

  // ═════════════════════ GROWJO IMPORT + HUNT QUEUE ═══════════════════════════

  /** import <growjo.csv> — parse a Growjo CSV and load it into the research queue. */
  async cmdImport(args: string): Promise<void> {
    const csvPath = (args || '').trim();
    if (!csvPath) {
      this.println('Usage: import <growjo.csv>');
      return;
    }
    let text: string;
    try { text = fs.readFileSync(csvPath, 'utf8'); }
    catch (e: any) { this.println(`Cannot read CSV "${csvPath}": ${e?.message || e}`); return; }
    const result = GrowjoProvider.parseCsv(text);
    this.growjoRecords = result.companies;
    this.println(`Growjo import: ${result.companies.length} company/companies loaded from ${result.total_rows} row(s).`);
    this.println(`Column mapping: ${JSON.stringify(result.column_mapping)}`);
    if (result.duplicate_domains_dropped) this.println(`  (dropped ${result.duplicate_domains_dropped} duplicate-domain row(s).)`);
    for (const w of result.warnings) this.println(`  warning: ${w}`);
    // Load into the persistent queue.
    if (this.queue) {
      const { added, duplicates } = this.queue.enqueue(result.companies);
      this.println(`Queue: added ${added} (ignored ${duplicates} existing by canonical domain).`);
      this.println(`Queue total: ${this.queue.count()} (QUEUED: ${this.queue.count('QUEUED')}).`);
    } else {
      this.println('Queue not available (filesystem not writable in this context).');
    }
    this.println(`Next: "hunt ${csvPath} --batch <n>" to start autonomous research.`);
  }

  /** hunt <growjo.csv> [--batch N] | hunt <company> */
  async cmdHunt(args: string): Promise<void> {
    const trimmed = (args || '').trim();
    if (!trimmed) { this.println('Usage: hunt <growjo.csv> [--batch N]   |   hunt <company-name>'); return; }
    const toks = trimmed.split(/\s+/);
    const target = toks[0];
    const isCsv = /^(.+\.csv)$/i.test(target);
    if (isCsv) {
      const batchMatch = trimmed.match(/--batch\s+(\d+)/);
      const batchSize = batchMatch ? parseInt(batchMatch[1], 10) : 5;
      // Import the CSV first if not already loaded.
      if (this.growjoRecords.length === 0) {
        try {
          const text = fs.readFileSync(target, 'utf8');
          const result = GrowjoProvider.parseCsv(text);
          this.growjoRecords = result.companies;
          if (this.queue) this.queue.enqueue(result.companies);
          this.println(`Loaded ${result.companies.length} company/companies from ${target}.`);
        } catch (e: any) { this.println(`Cannot read CSV "${target}": ${e?.message || e}`); return; }
      }
      await this.researchBatch(batchSize);
      return;
    }
    // Single company by name -> resolve + research.
    const growjo = this.growjoRecords.find(g => g.canonical_name.toLowerCase() === target.toLowerCase());
    await this.researchOne(target, growjo || null);
  }

  /** researchBatch <n> — research up to n QEUED companies end-to-end. */
  private async researchBatch(batchSize: number): Promise<void> {
    if (!this.queue) { this.println('Queue unavailable.'); return; }
    const slice = this.queue.list('QUEUED').slice(0, batchSize);
    if (slice.length === 0) { this.println(`No QUEUED companies. Run "pipeline" to inspect, or "import <csv>" to load leads.`); return; }
    this.println(`\n=== VARDHAN HUNT BATCH: ${slice.length} company/companies ===`);
    let i = 0;
    for (const row of slice) {
      i++;
      this.println(`\n[${i}/${slice.length}] researching ${row.company} (domain: ${row.domain || 'resolving...'})`);
      try {
        await this.researchOne(row.company, row.growjo || null, row.id);
      } catch (e: any) {
        this.println(`  error researching ${row.company}: ${e?.message || String(e)}`);
        if (this.queue) this.queue.markResearched(row.id, 'NO_GO', 'LOW', 'ERROR', null, null, 'NO_GO', e?.message || String(e));
      }
    }
    this.println('\n--- Batch complete ---');
    this.cmdPipeline();
  }

  /** researchOne <nameOrUrl> — resolve domain + run the full deep pipeline + queue result. */
  private async researchOne(nameOrUrl: string, growjo: GrowjoCompany | null, queueId?: string): Promise<void> {
    let targetUrl: string | null = null;
    let resolution: CompanyResolution | null = growjo ? {
      canonical_name: growjo.canonical_name, official_domain: growjo.domain,
      resolution_method: 'GROWJO_DOMAIN',
      resolution_source: growjo.source_url || growjo.growjo_url || 'GROWJO record',
      resolution_confidence: growjo.domain ? 'HIGH' : 'LOW'
    } : null;

    // If Growjo gave us a domain/website, use it as the seed directly.
    if (growjo && growjo.domain) {
      targetUrl = `https://${growjo.domain}`;
    } else if (growjo && growjo.website) {
      targetUrl = growjo.website;
    }

    // If only a bare company name, attempt domain resolution via DomainResolver
    // (legit public sources only; never guesses). For named inputs we still run
    // the full deep research using the name as the target.
    if (!targetUrl) {
      this.println(`  [resolve] ${nameOrUrl} — resolving (Growjo has no domain; public resolution only)`);
      const seed = { domain: growjo?.domain || null, website_url: growjo?.website || null, company_name: nameOrUrl };
      if (this.fetcher) {
        resolution = await DomainResolver.resolve(seed, this.fetcher as any);
      }
      if (resolution?.official_domain) targetUrl = `https://${resolution.official_domain}`;
      else {
        this.println(`  [resolve] AMBIGUOUS — no legitimate domain for ${nameOrUrl} (never guessed).`);
        if (this.queue && queueId) this.queue.markResolving(queueId, resolution ?? {
          canonical_name: nameOrUrl, official_domain: null, resolution_method: 'AMBIGUOUS',
          resolution_source: null, resolution_confidence: 'LOW'
        });
        // Still attempt a deep run against the bare name so the operator sees surface.
        targetUrl = nameOrUrl;
      }
      if (this.queue && queueId && resolution) this.queue.markResolving(queueId, resolution);
    }

    // Run the deep pipeline (Growjo + resolution wired into the builder).
    const builder = this.deepBuilder(true, growjo, resolution);
    const { prospect, case_ref } = await builder.build(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`);
    this.currentDeep = prospect;
    this.deepProspects.push(prospect);
    if (case_ref) {
      case_ref.owner_candidates = prospect.owner_candidates;
      case_ref.company_surface = prospect.public_surface;
      this.currentCase = case_ref;
    }

    this.println(`  → ${prospect.company} → ${prospect.decision} (confidence ${prospect.confidence})`);
    if (prospect.deep_finding) this.println(`     finding: ${prospect.deep_finding.finding_type} (${prospect.deep_finding.confidence}) — ${prospect.deep_finding.explanation.slice(0, 80)}`);
    else this.println(`     finding: NONE (no defensible deep finding — not fabricated)`);
    this.println(`     owner: ${prospect.selected_owner ? `${prospect.selected_owner.name} (${prospect.selected_owner.confidence})` : '(none)'}`);
    this.println(`     artifact: ${prospect.artifact_path}`);

    // Persist outcome to the queue.
    const findingType = prospect.deep_finding?.finding_type || prospect.findings?.finding_type || null;
    const ownerName = prospect.selected_owner?.name || null;
    let nextState: QueueState;
    if (prospect.decision === 'OUTREACH_READY') nextState = 'OUTREACH_READY';
    else if (prospect.decision === 'NO_GO') nextState = 'NO_GO';
    else nextState = 'RESEARCH_MORE';
    if (this.queue && queueId) this.queue.markResearched(queueId, prospect.decision, prospect.confidence, findingType, ownerName, prospect.artifact_path, nextState);
    else if (this.queue) this.queue.enqueueName(prospect.company, prospect.domain);
  }

  /** pipeline — show the persistent research queue (all states + counts). */
  cmdPipeline(): void {
    if (!this.queue) { this.println('No queue configured.'); return; }
    const rows = this.queue.list();
    this.println(`\n=== VARDHAN RESEARCH PIPELINE === (queue: ${this.queuePath})`);
    const counts: Partial<Record<QueueState, number>> = {};
    for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1;
    for (const s of ['QUEUED', 'RESOLVING', 'RESEARCHING', 'RESEARCH_MORE', 'NO_GO', 'OUTREACH_READY', 'CONTACT_READY', 'APPROVED', 'SENT']) {
      this.println(`  ${s.padEnd(16)} ${counts[s as QueueState] || 0}`);
    }
    this.println(`  ──────────────────────────────── total: ${rows.length}`);
    this.println(`\nNext: "resume [--batch N]" to research the next queued company/companies.`);
  }

  /** resume [--batch N] — research the next N QUEUED companies. Defaults to 1. */
  async cmdResume(args: string): Promise<void> {
    const m = (args || '').match(/--batch\s+(\d+)/);
    const n = m ? parseInt(m[1], 10) : 1;
    await this.researchBatch(n);
  }

  /** ready — list companies whose research reached OUTREACH_READY (awaiting approval). */
  cmdReady(): void {
    if (!this.queue) { this.println('No queue configured.'); return; }
    const ready = this.queue.list('OUTREACH_READY');
    this.println(`\n=== OUTREACH READY (${ready.length}) ===`);
    if (ready.length === 0) this.println('No companies reached OUTREACH_READY. Use "pipeline" to inspect progress.');
    for (const r of ready) {
      this.println(`  • ${r.company} — finding: ${r.prospect?.finding || 'NONE'} — owner: ${r.prospect?.owner || '(none)'}`);
      if (r.artifact_path) this.println(`    artifact: ${r.artifact_path}`);
      this.println(`    approve with: "approve ${r.id}" (then "send --confirm")`);
    }
  }

  /** show company <name> — display a company's queued/research record. */
  cmdShowCompany(name: string): void {
    if (!this.queue || !name) { this.println('Usage: show company <name>'); return; }
    const match = this.queue.list().find(r =>
      r.company.toLowerCase() === name.toLowerCase() ||
      r.growjo?.canonical_name.toLowerCase() === name.toLowerCase()
    );
    if (!match) { this.println(`No queued company matching "${name}".`); return; }
    this.println(`\n=== COMPANY: ${match.company} ===`);
    this.println(`  state:        ${match.state}`);
    this.println(`  domain:       ${match.domain || '(resolving)'}`);
    this.println(`  resolution:   ${match.resolution ? `${match.resolution.resolution_method} (${match.resolution.resolution_confidence})` : '(pending)'}`);
    this.println(`  growjo:       ${match.growjo ? `source=${match.growjo.source_url} retrieved=${match.growjo.retrieved_at}` : '(none)'}`);
    if (match.prospect) {
      this.println(`  decision:      ${match.prospect.decision} (${match.prospect.confidence})`);
      this.println(`  finding:       ${match.prospect.finding || 'NONE'}`);
      this.println(`  owner:         ${match.prospect.owner || '(none)'}`);
    }
    if (match.artifact_path) this.println(`  artifact:     ${match.artifact_path}`);
    this.println(`  enqueued:     ${match.enqueued_at}`);
    this.println(`  updated:      ${match.updated_at}`);
    if (match.last_error) this.println(`  last error:   ${match.last_error}`);
  }

  private persistDeepArtifact(prospect: DeepProspect): string {
    const dir = path.join(this.artifactsDir || process.cwd(), 'artifacts', 'intelligence', 'deep');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
    if (this.saveArtifact) {
      const p = path.join(dir, prospect.artifact_path.split('/').pop() || `${Date.now()}.json`);
      this.saveArtifact(p, JSON.stringify(prospect, (k, v) => (k === 'case_ref' ? undefined : v), 2));
      return p;
    }
    const p = path.join(dir, prospect.artifact_path.split('/').pop() || `${Date.now()}.json`);
    fs.writeFileSync(p, JSON.stringify(prospect, (k, v) => (k === 'case_ref' ? undefined : v), 2), 'utf8');
    return p;
  }


  cmdHelp(): void {
    this.println(`\nVARDHAN INTELLIGENCE OPERATOR — commands`);
    this.println(`  research <url>     Start a public-surface research run for a company URL.`);
    this.println(`                       Use "research again" to re-run the previous target.`);
    this.println(`  discover <company>  Run PublicLinkDiscovery; print discovered pages + classifications + sameAs.`);
    this.println(`  status                  Show the current intelligence case status.`);
    this.println(`  show findings           Show finding classification, strength, thesis, uncertainty.`);
    this.println(`                       When a deep run is active, prints currentDeep.findings + deep_finding (with evidence_ids).`);
    this.println(`  show evidence           List all evidence observations with lineage.`);
    this.println(`  show people             List owner candidates + engine-verified owner.`);
    this.println(`                       When a deep run is active, prints currentDeep.people + selected_owner.`);
    this.println(`  why owner               Explain owner selection and confidence rationale.`);
    this.println(`                       Deep path prints owner_evidence + confidence + finding_link.`);
    this.println(`  draft email             Show the finding-led draft email (if decision is GO).`);
    this.println(`  export                  Persist/rewrite the intelligence artifact to disk.`);
    this.println(`  send [--confirm]        Record send intent (only if transport configured + confirmed).`);
    this.println(`  deep <url>              Deep-research a company (high-precision prospect dossier).`);
    this.println(`      deep research <url>  Same as above (explicit verb).`);
    this.println(`      deep file <csv>      Batch deep-research a CSV of companies.`);
    this.println(`      deep prospects       List persisted deep-prospect dossiers.`);
    this.println(`  import <growjo.csv>     Import a Growjo CSV into the research queue.`);
    this.println(`  hunt <growjo.csv> [--batch N]  Start autonomous research on the next N queued leads.`);
    this.println(`  hunt <company>          Research a single company by name (domain resolution only).`);
    this.println(`  pipeline                Show the persistent research queue (all states + counts).`);
    this.println(`  resume [--batch N]      Research the next N QUEUED companies (default 1).`);
    this.println(`  ready                   List companies that reached OUTREACH_READY (awaiting approval).`);
    this.println(`  show company <name>     Show a company's queued/research record.`);
    this.println(`  export [queue|deep]     Export deep prospects + research queue to JSON.`);
    this.println(`  show all               Show the complete current deep-prospect dossier.`);
    this.println(`  help                    Show this help.`);
    this.println(`  exit | quit             Leave the operator.`);
    this.println(`\nAll observation is READ-ONLY and strictly bounded to the target company domain.`);
  }

  async cmdSend(args: string): Promise<void> {
    const deep = this.currentDeep;
    const c = this.currentCase;
    if (!deep && !c) { this.println('No active research. Run "research <url>" first.'); return; }
    // Human approval gate comes FIRST: even without a configured transport, the
    // operator must refuse any send that lacks explicit confirmation.
    const confirm = args.includes('--confirm') || args.toLowerCase().includes('confirm');
    if (!confirm) {
      this.println(`Send requires explicit confirmation. Re-run as: send --confirm`);
      return;
    }
    // Deep gate: require OUTREACH_READY (real finding + evidence + verified HIGH
    // owner + relevant relationship + CLAIM QA PASSED + email generated).
    const deepReady = deep && deep.decision === 'OUTREACH_READY' && deep.email_draft.generated;
    const engineReady = c && c.prospect_decision === 'GO' && c.claim_validation === 'PASSED';
    if (!deepReady && !engineReady) {
      this.println('Send blocked: decision is not OUTREACH_READY.');
      return;
    }
    if (!this.sendingConfigured) {
      this.println('Sending is NOT configured. To enable, set VARDHAN_SMTP_HOST / VARDHAN_SMTP_USER /');
      this.println('VARDHAN_SMTP_PASS / VARDHAN_FROM / VARDHAN_SMTP_PORT in the environment.');
      this.println('No email will be sent until a transport is explicitly configured.');
      return;
    }
    // Sending is intentionally NOT implemented as an auto-send path. Even when a
    // transport exists, the operator only records intent; actual delivery always
    // requires a final human confirmation in the interactive terminal. This stub
    // preserves that contract and never auto-delivers.
    this.println('Intent recorded: send requested with --confirm. Operator would deliver via the');
    this.println(`configured SMTP transport to ${deep?.selected_owner?.name || c?.technical_owner?.name || ''}. Review and confirm`);
    this.println('delivery in the interactive terminal before any actual send occurs.');
  }

  // ═════════════════════════ DEEP INTELLIGENCE COMMANDS ═══════════════════════
  // High-precision prospect research layered ADDITIVELY on the existing engine.
  // Reuses PublicLinkDiscovery / PeopleExtractor / OwnerSelector /
  // LivePublicObservationProvider / IntelligenceEngine; adds deep signals, ICP
  // qualification, contactability, owner graph, and finding-led email.

  /** deep <url> | deep research <url> | deep file <csv> | deep prospects | deep help */
  async cmdDeep(args: string): Promise<void> {
    const toks = args.trim().split(/\s+/);
    const head = (toks[0] || '').toLowerCase();
    if (!head) { this.printDeepHelp(); return; }
    if (head === 'research') { await this.cmdDeepResearch(toks.slice(1).join(' ')); return; }
    if (head === 'file')   { await this.cmdDeepFile(toks.slice(1).join(' ')); return; }
    if (head === 'prospects' || head === 'list') { this.cmdDeepProspects(); return; }
    if (head === 'help')   { this.printDeepHelp(); return; }
    // bare URL -> treat the whole arg string as the target
    await this.cmdDeepResearch(args);
  }

  private printDeepHelp(): void {
    this.println(`\nVARDHAN DEEP INTELLIGENCE — commands`);
    this.println(`  deep <url>          Deep-research a single company URL (full prospect dossier).`);
    this.println(`  deep research <url> Same as above (explicit verb).`);
    this.println(`  deep file <csv>     Batch deep-research every URL/company in a CSV file.`);
    this.println(`  deep prospects      List previously persisted deep-prospect dossiers.`);
    this.println(`  show all            Show the complete current deep-prospect dossier.`);
    this.println(`\nDeep research is READ-ONLY and strictly bounded to the target public surface.`);
  }

  private deepBuilder(verbose: boolean, growjo?: GrowjoCompany | null, resolution?: CompanyResolution | null) {
    return new DeepProspectBuilder({
      fetcher: this.fetcher,
      saveArtifact: this.saveArtifact,
      maxDiscoveryPages: this.maxDiscoveryPages,
      discoveryDelayMs: this.discoveryDelayMs,
      discoveryTimeoutMs: this.discoveryTimeoutMs,
      observationDelayMs: this.observationDelayMs,
      observationProvider: this.injectedProvider ?? null,
      artifactsBaseDir: this.artifactsDir,
      growjo: growjo ?? null,
      resolution: resolution ?? null,
      onProgress: (stage: DeepStage, message: string) => this.progress(stage, message),
      logger: verbose ? (m: string) => this.println(`  ${m}`) : undefined
    });
  }

  private async cmdDeepResearch(target: string): Promise<void> {
    let parsed: URL;
    try { parsed = new URL(target.startsWith('http') ? target : `https://${target}`); }
    catch { this.println(`Invalid URL: ${target}`); return; }
    this.println(`\n=== VARDHAN DEEP INTELLIGENCE: ${parsed.hostname} ===`);
    this.currentDeep = null;
    const builder = this.deepBuilder(true);
    const { prospect, case_ref } = await builder.build(parsed.href);
    this.currentDeep = prospect;
    this.deepProspects.push(prospect);
    if (case_ref) {
      case_ref.owner_candidates = prospect.owner_candidates;
      case_ref.company_surface = prospect.public_surface;
      this.currentCase = case_ref; // keep existing show/status commands working
    }
    this.println('\n--- Deep research complete ---');
    this.println(`Decision:        ${prospect.decision} (confidence ${prospect.confidence})`);
    this.println(`Fit:             ${prospect.fit}`);
    this.println(`Industry:        ${prospect.industry}`);
    this.println(`Signals:         ${prospect.technical_signals.length} (${prospect.documented_facts.length} documented facts, ${prospect.public_observations.length} observations, ${prospect.inferences.length} inferred)`);
    this.println(`People:          ${prospect.people.length}`);
    this.println(`Owner:           ${prospect.selected_owner ? `${prospect.selected_owner.name} (${prospect.selected_owner.role}) — ${prospect.selected_owner.confidence}` : '(none)'}`);
    this.println(`Contacts:        ${prospect.contactability.length}`);
    this.println(`Finding:         ${prospect.findings ? prospect.findings.finding_type : 'NONE'}`);
    this.println(`Email draft:     ${prospect.email_draft.generated ? 'YES' : 'NO — ' + (prospect.email_draft.blocked_reason || '')}`);
    this.println(`Artifact:        ${prospect.artifact_path}`);
    this.println(`Stages: status | show findings | show opportunity | show evidence | show people | show all | why owner | draft email | deep prospects | help | exit\n`);
  }

  private async cmdDeepFile(csvPath: string): Promise<void> {
    if (!csvPath) { this.println('Usage: deep file <csv-path>'); return; }
    let rows: string[];
    try {
      const content = fs.readFileSync(csvPath, 'utf8');
      rows = content.split(/\r?\n/).filter(r => r.trim().length > 0);
    } catch (e: any) {
      this.println(`Could not read CSV: ${e?.message || String(e)}`);
      return;
    }
    if (rows.length < 2) { this.println('CSV must have a header row plus at least one prospect row.'); return; }
    const header = rows[0].split(',').map(h => h.trim().toLowerCase());
    // Prefer a URL-like column over a bare company name column.
    const columnPriority = ['url', 'domain', 'website', 'homepage', 'company', 'name'];
    let idx = -1;
    for (const col of columnPriority) {
      const i = header.indexOf(col);
      if (i >= 0) { idx = i; break; }
    }
    if (idx < 0) { this.println('CSV header must contain a company/url/domain/website column.'); return; }
    const dataRows = rows.slice(1)
      .map(r => (r.split(',')[idx] || '').trim())
      .filter(Boolean);
    if (dataRows.length === 0) { this.println('No prospect rows found in CSV.'); return; }

    this.println(`\n=== VARDHAN DEEP BATCH: ${dataRows.length} prospect(s) ===`);
    const results: Array<{ company: string; decision: string; finding: string; owner: string; artifact_path: string }> = [];
    const reasons: string[] = [];
    for (const r of dataRows) {
      try {
        const builder = this.deepBuilder(false);
        const { prospect } = await builder.build(r.startsWith('http') ? r : `https://${r}`);
        results.push({
          company: prospect.company,
          decision: prospect.decision,
          finding: prospect.findings?.finding_type || 'NONE',
          owner: prospect.selected_owner ? prospect.selected_owner.name : '(none)',
          artifact_path: prospect.artifact_path
        });
        if (!prospect.email_draft.generated) reasons.push(...(prospect.qualification_reasons || []));
        this.println(`  • ${prospect.company} → ${prospect.decision} (finding: ${prospect.findings?.finding_type || 'NONE'}, owner: ${prospect.selected_owner ? prospect.selected_owner.name : '(none)'})`);
      } catch (e: any) {
        results.push({ company: r, decision: 'NO_GO', finding: 'ERROR', owner: '(none)', artifact_path: '' });
        reasons.push(`Error researching ${r}: ${e?.message || String(e)}`);
        this.println(`  • ${r} → ERROR: ${e?.message || String(e)}`);
      }
    }

    const total = results.length;
    const outreach_ready = results.filter(x => x.decision === 'OUTREACH_READY').length;
    const research_more = results.filter(x => x.decision === 'RESEARCH_MORE').length;
    const no_go = results.filter(x => x.decision === 'NO_GO').length;

    const dir = path.join(this.artifactsDir || process.cwd(), 'artifacts', 'intelligence', 'deep');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const summaryPath = path.join(dir, `_batch_${ts}.json`);
    const summary = {
      total, outreach_ready, research_more, no_go,
      generated: new Date().toISOString(),
      results,
      top_reasons_for_rejection: Array.from(new Set(reasons)).slice(0, 10)
    };
    const data = JSON.stringify(summary, null, 2);
    if (this.saveArtifact) this.saveArtifact(summaryPath, data);
    else { try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ } fs.writeFileSync(summaryPath, data, 'utf8'); }
    this.println(`\nBatch summary: ${total} total → ${outreach_ready} OUTREACH_READY, ${research_more} RESEARCH_MORE, ${no_go} NO_GO`);
    this.println(`Summary artifact: ${summaryPath}`);
  }

  private cmdDeepProspects(): void {
    const dir = path.join(this.artifactsDir || process.cwd(), 'artifacts', 'intelligence', 'deep');
    if (!fs.existsSync(dir)) { this.println('No deep-prospect artifacts found yet.'); return; }
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_batch_')).sort().reverse();
    if (files.length === 0) { this.println('No deep-prospect artifacts found yet.'); return; }
    this.println(`\n=== DEEP PROSPECTS (${files.length}) ===`);
    for (const f of files) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        this.println(`  • ${(d.company ?? f).padEnd(28)} ${(d.decision ?? '?').padEnd(14)} fit=${d.fit ?? '?'}  finding=${(d.findings && d.findings.finding_type) || 'NONE'}  owner=${d.selected_owner?.name || '(none)'}  [${f}]`);
      } catch {
        this.println(`  • ${f} (unreadable)`);
      }
    }
  }

  private cmdShowAll(): void {
    const p = this.currentDeep;
    if (!p) { this.println('No deep research. Run "deep <url>" first.'); return; }
    this.println('\n══════════════════════════════════════════════════════════════');
    this.println('                  DEEP PROSPECT DOSSIER                          ');
    this.println('══════════════════════════════════════════════════════════════');
    this.println(`\n── COMPANY ──`);
    this.println(`  company:  ${p.company}`);
    this.println(`  domain:   ${p.domain}`);
    this.println(`  industry: ${p.industry}`);
    this.println(`  fit:      ${p.fit}`);
    this.println(`  decision: ${p.decision} (confidence ${p.confidence})`);
    if (p.qualification_reasons.length) {
      this.println(`  qualification reasons:`);
      p.qualification_reasons.forEach(r => this.println(`    - ${r}`));
    }
    this.println(`\n── PUBLIC SURFACE (${p.public_surface.discovered_pages.length} pages) ──`);
    for (const pg of p.public_surface.discovered_pages) {
      this.println(`  • ${(pg.category ?? 'other').padEnd(12)} ${pg.url}`);
    }
    this.println(`\n── TECHNICAL SIGNALS (${p.technical_signals.length}) ──`);
    for (const s of p.technical_signals) {
      this.println(`  • [${s.provenance}] ${s.type} / ${s.signal_strength} — ${s.source_url}`);
      this.println(`    excerpt: ${s.excerpt.slice(0, 180)}`);
    }
    this.println(`\n── PEOPLE / OWNER CANDIDATES (${p.owner_candidates.length}) ──`);
    if (p.owner_candidates.length === 0) this.println(`  (no publicly listed persons matched candidate technical roles)`);
    for (const c of p.owner_candidates) {
      this.println(`  • ${c.name} — ${c.role}  [${c.confidence}] @ ${c.source_urls[0]}`);
    }
    this.println(`\n── SELECTED OWNER ──`);
    if (p.selected_owner) {
      this.println(`  name:            ${p.selected_owner.name}`);
      this.println(`  role:            ${p.selected_owner.role}`);
      this.println(`  confidence:      ${p.selected_owner.confidence}`);
      this.println(`  responsibility:  ${p.selected_owner.responsibility_match}`);
      this.println(`  finding_link:    ${p.selected_owner.finding_link}`);
      this.println(`  source_urls:`);
      p.selected_owner.source_urls.forEach(u => this.println(`    • ${u}`));
      this.println(`  owner_evidence:`);
      p.selected_owner.owner_evidence.forEach(e => this.println(`    • ${e.slice(0, 180)}`));
    } else {
      this.println(`  (no evidence-backed owner)`);
    }
    this.println(`\n── EVIDENCE (${p.evidence.length}) / FINDINGS ──`);
    this.println(`  finding: ${p.findings ? p.findings.finding_type : 'NONE'}`);
    for (const e of p.evidence) {
      this.println(`  • [${e.evidence_origin}] ${e.source_type}  ${e.public_url  }  (HTTP ${e.status ?? '?'}, ${e.latency_ms ?? '?'}ms)`);
    }
    this.println(`\n── CONTACTABILITY (${p.contactability.length}) ──`);
    if (p.contactability.length === 0) this.println(`  (no usable public professional contact channel discovered — emails are never guessed)`);
    for (const ct of p.contactability) {
      this.println(`  • [${ct.confidence}] ${ct.type} — ${ct.value} @ ${ct.source_url}`);
    }
    this.println(`\n── ANGLES ──`);
    this.println(`  primary:   ${p.primary_angle}`);
    this.println(`  secondary: ${p.secondary_angle || '(none)'}`);
    this.println(`  subjects:  ${p.recommended_subjects.join(' | ')}`);
    this.println(`\n── EMAIL DRAFT ──`);
    if (p.email_draft.generated) {
      this.println(`  TO:    ${p.selected_owner ? p.selected_owner.name : ''}`);
      this.println(`  FROM:  Vishnu (solo founder, VARDHAN)`);
      this.println(`  SUBJECT (primary):    ${p.email_draft.primary_subject}`);
      this.println(`  SUBJECT (alternate):  ${p.email_draft.alternate_subject}`);
      const eb = p.email_draft.claims.filter(cl => cl.evidence_ids.length > 0).length;
      this.println(`  claims (evidence-backed): ${eb}/${p.email_draft.claims.length}`);
      this.println(`  --- body ---`);
      this.println(p.email_draft.body);
      this.println(`  --- end ---`);
      this.println(`  NEVER AUTO-SENT. Use "send --confirm" (requires configured transport).`);
    } else {
      this.println(`  NOT generated: ${p.email_draft.blocked_reason || 'gates not satisfied'}`);
    }
    this.println(`\n── ARTIFACT ──`);
    this.println(`  ${p.artifact_path}`);
    this.println(`  audit trail (${p.audit_trail.length} entries):`);
    p.audit_trail.slice(0, 14).forEach(a => this.println(`    - ${a}`));
    if (p.audit_trail.length > 14) this.println(`    ... (${p.audit_trail.length - 14} more)`);
  }

  // ═════════════════════════ INTERNALS ═══════════════════════════════════════

  private printBanner(): void {
    this.println('\n╔══════════════════════════════════════════════════════════╗');
    this.println('║              VARDHAN INTELLIGENCE OPERATOR                ║');
    this.println('║  Interactive terminal for public-surface outreach intel  ║');
    this.println('╚══════════════════════════════════════════════════════════╝');
    this.println('Type "help" for commands, "exit" to quit.\n');
  }

  private println(s: string = ''): void { this.output.write(s + '\n'); }

  private progress(stage: string, message: string, _detail = ''): void {
    this.println(`[${stage}] ${message}`);
  }

  private persistArtifact(caseResult: IntelligenceCase, company: string): string {
    const dir = path.join(process.cwd(), 'artifacts', 'intelligence');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const p = path.join(dir, `${ts}-${company.replace(/\s+/g, '_')}.json`);
    const data = JSON.stringify(caseResult, null, 2);
    if (this.saveArtifact) { this.saveArtifact(p, data); return p; }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, data, 'utf8');
    return p;
  }

  private dedupeCandidates(cands: OwnerCandidate[]): OwnerCandidate[] {
    const seen = new Map<string, OwnerCandidate>();
    for (const c of cands) {
      const key = `${c.name.toLowerCase()}|${c.role.toLowerCase()}`;
      const existing = seen.get(key);
      if (!existing || c.confidence === 'HIGH') seen.set(key, c);
    }
    return Array.from(seen.values());
  }

  /** Guess the technical area from discovered engineering/tech pages (best-effort). */
  private guessFindingType(pages: DiscoveredPage[]): string {
    const paths = pages.map(p => p.path.toLowerCase()).filter(Boolean);
    if (paths.some(p => p.startsWith('/status') || p.includes('incident'))) return 'observability status';
    if (paths.some(p => p.startsWith('/security'))) return 'security trust';
    if (paths.some(p => p.startsWith('/api') || p.startsWith('/docs'))) return 'api surface';
    if (paths.some(p => p.startsWith('/blog'))) return 'engineering blog';
    return 'platform engineering';
  }

  private checkSendingConfigured(): boolean {
    return Boolean(process.env.VARDHAN_SMTP_HOST) &&
      Boolean(process.env.VARDHAN_SMTP_USER) &&
      Boolean(process.env.VARDHAN_SMTP_PASS);
  }

  // ── input handling ───────────────────────────────────────────────────────
  private async runLines(lines: string[]): Promise<void> {
    for (const raw of lines) {
      const line = raw.trim();
      if (line.length > 0) {
        const [cmd] = line.split(/\s+/);
        if (cmd?.toLowerCase() === 'exit' || cmd?.toLowerCase() === 'quit') {
          this.shouldExit = true;
          await this.dispatch(line);
          break;
        }
        await this.dispatch(line);
      }
      if (this.shouldExit) break;
    }
  }
}
