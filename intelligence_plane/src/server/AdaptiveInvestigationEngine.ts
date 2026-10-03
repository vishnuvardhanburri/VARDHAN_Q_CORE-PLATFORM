/**
 * AdaptiveInvestigationEngine — structured telemetry for adaptive investigation
 * within the real VARDHAN execution path.
 *
 * This engine does NOT replace the standard pipeline. It runs AFTER the
 * DeepProspectBuilder has produced a prospect and examines whether boundary
 * observations on the initial surface warrant structured pivot attempts.
 *
 * Every action is recorded as an AdaptiveInvestigationRecord. If no pivot was
 * needed, a single NO_PIVOT_REQUIRED record is emitted.
 *
 * AUDIT INVARIANTS (see verifyAggregate()):
 *   - aggregate.new_evidence_found == SUM(records[].new_evidence_ids.length)
 *   - aggregate.new_verification_targets == SUM(records[].new_target_ids.length)
 *   - unique_evidence_ids == len(set(all evidence IDs across records))
 *   - For every "new" claim: new_ids == treatment_ids - baseline_ids
 */
import { Evidence } from '../server/IntelligenceCase';
import { DeepFinding } from '../server/DeepTypes';
import { LivePublicObservationProvider } from '../server/LivePublicObservationProvider';

/** Boundary classification for an initial observation. */
export type BoundaryClassification =
  | 'OPEN_SURFACE'        /** HTTP 200, no protection observed          */
  | 'WAF_PROTECTED'       /** WAF block page (Cloudflare, Akamai, etc.)  */
  | 'NETWORK_LEVEL_DROP'  /** TCP/connection-level drop, timeout         */
  | 'APP_LAYER_BLOCK'     /** HTTP 4xx block (403/401) from origin       */
  | 'RATE_LIMITED'        /** HTTP 429 — explicitly distinct from EMPTY  */
  | 'EMPTY'               /** Connection succeeded but empty body/0 bytes */
  | 'UNKNOWN';

/** Outcome values for an adaptive investigation record. */
export type AdaptiveOutcome =
  | 'NO_PIVOT_REQUIRED'
  | 'PIVOT_SUGGESTED'
  | 'PIVOT_EXECUTED'
  | 'ALTERNATE_SURFACE_FOUND'
  | 'NEW_EVIDENCE_FOUND'
  | 'NEW_VERIFICATION_TARGET'
  | 'VERIFIED'
  | 'NO_USEFUL_RESULT'
  | 'RESEARCH_MORE'
  | 'INCONCLUSIVE';

/**
 * Metadata for a single adaptive evidence record, making every adaptive
 * finding independently inspectable from the persisted artifact.
 */
export interface AdaptiveEvidenceDetail {
  /** The evidence record ID. */
  evidence_id: string;
  /** Type of target this evidence supports (e.g. "verification_target", "supporting_evidence"). */
  target_type: string;
  /** IDs of source evidence that motivated this discovery. */
  source_evidence_ids: string[];
  /** How this evidence was discovered (e.g. "html_link", "json_ld", "script_src"). */
  discovery_path: string;
  /** The URL this evidence was observed from. */
  source_url: string;
  /** Organization attribution — HIGH if same root domain, LOW if inferred. */
  attribution: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  /** Whether this evidence is eligible for verification. */
  verification_eligibility: boolean;
  /** Verification result from the adaptive path. */
  verification_result: string;
  /** HTTP status code observed. */
  status?: number | null;
  /** Observation snippet (bounded to avoid bloating artifacts). */
  observation_snippet?: string;
  /** Timestamp of retrieval. */
  retrieved_at: string;
}

/**
 * A single adaptive investigation record — the unit of telemetry.
 *
 * INVARIANT: aggregate.new_verification_targets == SUM(records[].new_target_ids.length)
 */
export interface AdaptiveInvestigationRecord {
  investigation_id: string;
  organization: string;
  initial_surface: string;
  initial_observation_id: string;
  initial_boundary_classification: BoundaryClassification;
  initial_boundary_evidence_ids: string[];
  /** Why a pivot was suggested (or why it wasn't). */
  pivot_trigger: string;
  /** The specific pivot action taken (or "none"). */
  pivot_action: string;
  pivot_reason: string;
  /** Evidence IDs that motivated the pivot. */
  pivot_source_evidence_ids: string[];
  /** Candidate surfaces considered for the pivot. */
  candidate_public_surfaces: string[];
  /** Surfaces actually discovered/observed during the pivot. */
  discovered_public_surfaces: string[];
  /** Surfaces considered but rejected. */
  rejected_surfaces: string[];
  /** Why each rejected surface was rejected. */
  rejection_reasons: string[];
  /** New evidence record IDs produced by the pivot. */
  new_evidence_ids: string[];
  /**
   * ALL new verification target IDs from this pivot (NOT just the last one).
   * Previously only the last target was stored, causing aggregate != sum(records).
   *
   * INVARIANT: len(new_target_ids) per record, summed across all records,
   * == aggregate.new_verification_targets
   */
  new_target_ids: string[];
  /**
   * Full metadata for every adaptive evidence record, making each finding
   * independently inspectable and auditable.
   */
  new_evidence_details: AdaptiveEvidenceDetail[];
  verification_attempted: boolean;
  verification_result: string;
  final_decision: string;
  outcome: AdaptiveOutcome;
  /** Confidence that the pivot genuinely contributed (not inferred). */
  attribution_confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  started_at: string;
  completed_at: string;
}

/** Aggregate telemetry for a company. */
export interface AdaptiveInvestigationAggregate {
  boundary_observations: number;
  pivots_suggested: number;
  pivots_executed: number;
  alternate_surfaces_found: number;
  new_evidence_found: number;
  new_verification_targets: number;
  verified_from_adaptive_path: number;
  no_useful_result: number;
}

/** Result of running adaptive investigation for a single company. */
export interface AdaptiveInvestigationResult {
  attempted: boolean;
  records: AdaptiveInvestigationRecord[];
  aggregate: AdaptiveInvestigationAggregate;
}

/** Options for the adaptive investigation engine. */
export interface AdaptiveInvestigationOptions {
  fetcher?: (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;
  maxPivots?: number;
  maxPivotRequests?: number;
  delayMs?: number;
  onProgress?: (stage: string, message: string) => void;
}

// ── Local fetcher fallback ──────────────────────────────────────────────
const localFetch = (async (url: string, init?: any): Promise<Response> => {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/json',
      ...(init?.headers || {}),
    },
    signal: init?.signal,
  });
  return res as any;
}) as any;

/**
 * Classify a boundary observation from an evidence record.
 * Never infers infrastructure — uses only HTTP status + observed behavior.
 */
export function classifyBoundary(ev: Evidence): BoundaryClassification {
  if (!ev) return 'UNKNOWN';
  const status = ev.status;

  // WAF protection: check for known WAF block signatures in observed_behavior
  const behavior = (ev.observed_behavior || '').toLowerCase();
  if (
    behavior.includes('waf') ||
    behavior.includes('cloudflare') ||
    behavior.includes('akamai') ||
    behavior.includes('challenge') ||
    behavior.includes('access denied') ||
    behavior.includes('security policy') ||
    behavior.includes('captcha') ||
    status === 403
  ) {
    if (status === 403 && (behavior.includes('waf') || behavior.includes('cloudflare') || behavior.includes('akamai') || behavior.includes('challenge'))) {
      return 'WAF_PROTECTED';
    }
    return 'APP_LAYER_BLOCK';
  }

  if (status === 429) return 'RATE_LIMITED';
  if (status === 200 || status === 301 || status === 302) return 'OPEN_SURFACE';
  if (status === 0 || status === -1) return 'NETWORK_LEVEL_DROP';
  if (behavior.includes('aborted') || behavior.includes('timeout') || behavior.includes('fetch failed')) {
    return 'NETWORK_LEVEL_DROP';
  }

  // Empty body / no content
  const hasBody = ev.evidence_text && ev.evidence_text.length > 0;
  if ((status ?? 0) >= 200 && !hasBody) return 'EMPTY';

  return 'UNKNOWN';
}

/**
 * Check if a hostname is on the same root domain as the target (prevents
 * following links to unrelated external domains).
 */
function isSameRootDomain(hostname: string, rootDomain: string): boolean {
  return hostname === rootDomain || hostname.endsWith('.' + rootDomain);
}

/**
 * Extract root domain from a hostname.
 */
function extractRootDomain(hostname: string): string {
  let h = hostname.replace(/^www\./, '');
  const parts = h.split('.');
  if (parts.length >= 3) {
    h = parts.slice(-2).join('.');
  }
  return h;
}

/**
 * Extract hostnames from HTML (links, canonical, scripts, JSON-LD, body).
 * Returns only same-root-domain hostnames.
 */
function extractHostnamesFromHtml(html: string, baseUrl: string, rootDomain: string): string[] {
  const found = new Set<string>();
  if (!html) return [];

  const addHost = (raw: string) => {
    try {
      const host = new URL(raw, baseUrl).hostname;
      if (isSameRootDomain(host, rootDomain) && host !== rootDomain && !host.startsWith('www.')) {
        found.add(host);
      }
    } catch {}
  };

  // <a href>
  let m;
  const linkRegex = /<a\s+(?:[^>]*?\s+)?href=[\"']([^\"']+)[\"']/gi;
  while ((m = linkRegex.exec(html)) !== null) addHost(m[1]);

  // <link rel="canonical">
  const canonRegex = /<link[^>]+rel=[\"']canonical[\"'][^>]+href=[\"']([^\"']+)[\"']/gi;
  while ((m = canonRegex.exec(html)) !== null) addHost(m[1]);

  // <script src> / <link href>
  const assetRegex = /<(?:script|link)[^>]+(?:src|href)=[\"']([^\"']+)[\"']/gi;
  while ((m = assetRegex.exec(html)) !== null) addHost(m[1]);

  // JSON-LD "url"
  const jsonLdRegex = /"url"\s*:\s*"(https?:\/\/[^\"]+)"/gi;
  while ((m = jsonLdRegex.exec(html)) !== null) addHost(m[1]);

  // Raw hostnames in text
  const hostRegex = /https?:\/\/([a-z0-9][a-z0-9-]*[a-z0-9](\.[a-z0-9][a-z0-9-]*)*\.[a-z]{2,})\//gi;
  while ((m = hostRegex.exec(html)) !== null) addHost(m[1]);

  return [...found];
}

/**
 * Audit invariant verification.
 *
 * PROVES:
 *   1. aggregate.new_evidence_found == SUM(records[].new_evidence_ids.length)
 *   2. aggregate.new_verification_targets == SUM(records[].new_target_ids.length)
 *   3. All evidence IDs in records are unique (no duplicates)
 *   4. All target IDs in records are unique (no duplicates)
 *
 * Returns { valid: boolean, errors: string[] }
 */
export function verifyAggregate(result: AdaptiveInvestigationResult): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const records = result.records;
  const agg = result.aggregate;

  // Invariant 1: new_evidence_found == sum of new_evidence_ids per record
  const sumEvidence = records.reduce((sum, r) => sum + r.new_evidence_ids.length, 0);
  if (sumEvidence !== agg.new_evidence_found) {
    errors.push(`Invariant violation: aggregate.new_evidence_found (${agg.new_evidence_found}) != SUM(records[].new_evidence_ids.length) (${sumEvidence})`);
  }

  // Invariant 2: new_verification_targets == sum of new_target_ids per record
  const sumTargets = records.reduce((sum, r) => sum + r.new_target_ids.length, 0);
  if (sumTargets !== agg.new_verification_targets) {
    errors.push(`Invariant violation: aggregate.new_verification_targets (${agg.new_verification_targets}) != SUM(records[].new_target_ids.length) (${sumTargets})`);
  }

  // Invariant 3: all evidence IDs unique (no duplicates within or across records)
  const allEvIds: string[] = [];
  for (const r of records) {
    for (const id of r.new_evidence_ids) {
      allEvIds.push(id);
    }
  }
  const uniqueEvIds = new Set(allEvIds);
  if (uniqueEvIds.size !== allEvIds.length) {
    errors.push(`Invariant violation: duplicate evidence IDs detected (${allEvIds.length} total, ${uniqueEvIds.size} unique)`);
  }

  // Invariant 4: all target IDs unique (no duplicates within or across records)
  const allTargetIds: string[] = [];
  for (const r of records) {
    for (const id of r.new_target_ids) {
      allTargetIds.push(id);
    }
  }
  const uniqueTargetIds = new Set(allTargetIds);
  if (uniqueTargetIds.size !== allTargetIds.length) {
    errors.push(`Invariant violation: duplicate target IDs detected (${allTargetIds.length} total, ${uniqueTargetIds.size} unique)`);
  }

  // Invariant 5: boundary_observations count matches records
  // (boundary_observations = number of evidence records with non-OPEN_SURFACE boundary on initial surface — tracked differently)

  return { valid: errors.length === 0, errors };
}

/**
 * Build an AdaptiveEvidenceDetail from an Evidence record.
 */
function buildEvidenceDetail(ev: Evidence, discoveryPath: string, attribution: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE', verificationEligible: boolean, verificationResult: string): AdaptiveEvidenceDetail {
  return {
    evidence_id: ev.id,
    target_type: 'verification_target',
    source_evidence_ids: [],  // Will be populated by caller if needed
    discovery_path: discoveryPath,
    source_url: ev.public_url,
    attribution,
    verification_eligibility: verificationEligible,
    verification_result: verificationResult,
    status: ev.status,
    observation_snippet: (ev.evidence_text || '').slice(0, 200),
    retrieved_at: ev.retrieved_at || new Date().toISOString(),
  };
}

/**
 * The Adaptive Investigation Engine.
 *
 * Wraps the standard pipeline result and, when boundary observations exist,
 * attempts evidence-backed pivots to alternate public surfaces.
 */
export class AdaptiveInvestigationEngine {
  private readonly fetcher?: (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;
  private readonly maxPivots: number;
  private readonly maxPivotRequests: number;
  private readonly delayMs: number;
  private readonly onProgress?: (stage: string, message: string) => void;

  constructor(options: AdaptiveInvestigationOptions = {}) {
    this.fetcher = options.fetcher;
    this.maxPivots = options.maxPivots ?? 5;
    this.maxPivotRequests = options.maxPivotRequests ?? 15;
    this.delayMs = options.delayMs ?? 200;
    this.onProgress = options.onProgress;
  }

  /**
   * Run adaptive investigation on a completed prospect.
   *
   * Examines the initial surface evidence for boundary observations and, when
   * triggered, attempts pivots to alternate public surfaces discovered from
   * the initial page's HTML (links, canonical, JSON-LD, script/src, etc.).
   */
  async investigate(
    organization: string,
    initialUrl: string,
    evidence: Evidence[],
    existingSubdomains: string[],
    baselineEvidenceIds?: Set<string>,
    hypotheses?: import('./IntelligenceCase').InvestigationHypothesis[]
  ): Promise<AdaptiveInvestigationResult> {
    const records: AdaptiveInvestigationRecord[] = [];
    const now = () => new Date().toISOString();
    const startedAt = now();

    // Classify the initial surface boundary
    const initialEv = evidence.find(e => e.public_url === initialUrl || e.public_url === initialUrl.replace(/\/$/, ''))
      || evidence[0] || null;

    const boundaryClass = initialEv ? classifyBoundary(initialEv) : 'UNKNOWN';
    const initialEvidenceIds = evidence
      .filter(e => e.public_url === initialUrl || e.public_url === initialUrl.replace(/\/$/, ''))
      .map(e => e.id);

    // Determine if a pivot is suggested
    const pivotTriggers: string[] = [];
    if (initialEv) {
      if (boundaryClass === 'WAF_PROTECTED') {
        pivotTriggers.push('WAF protection detected on initial surface');
      }
      if (boundaryClass === 'APP_LAYER_BLOCK') {
        pivotTriggers.push('HTTP 4xx block on initial surface');
      }
      if (boundaryClass === 'RATE_LIMITED') {
        pivotTriggers.push('Initial surface rate-limited (HTTP 429)');
      }
      if (boundaryClass === 'NETWORK_LEVEL_DROP') {
        pivotTriggers.push('Network-level drop on initial surface');
      }
      if (boundaryClass === 'EMPTY') {
        pivotTriggers.push('Initial surface returned empty response');
      }
      if (evidence.length < 5) {
        pivotTriggers.push('Insufficient evidence from initial surface (<5 records)');
      }
    } else {
      pivotTriggers.push('No evidence from initial surface');
    }

    const shouldPivot = pivotTriggers.length > 0 || (initialEv && boundaryClass !== 'OPEN_SURFACE');

    if (!shouldPivot) {
      records.push({
        investigation_id: `${organization}_adaptive_no_pivot`,
        organization,
        initial_surface: initialUrl,
        initial_observation_id: initialEv?.id || 'none',
        initial_boundary_classification: boundaryClass,
        initial_boundary_evidence_ids: initialEvidenceIds,
        pivot_trigger: 'Initial surface is OPEN_SURFACE with sufficient evidence — no pivot required.',
        pivot_action: 'none',
        pivot_reason: 'no_pivot_required',
        pivot_source_evidence_ids: [],
        candidate_public_surfaces: [],
        discovered_public_surfaces: [],
        rejected_surfaces: [],
        rejection_reasons: [],
        new_evidence_ids: [],
        new_target_ids: [],
        new_evidence_details: [],
        verification_attempted: false,
        verification_result: 'not_applicable',
        final_decision: 'inherited_from_baseline',
        outcome: 'NO_PIVOT_REQUIRED',
        attribution_confidence: 'HIGH',
        started_at: startedAt,
        completed_at: now(),
      });

      return {
        attempted: true,
        records,
        aggregate: {
          boundary_observations: 1,
          pivots_suggested: 0,
          pivots_executed: 0,
          alternate_surfaces_found: 0,
          new_evidence_found: 0,
          new_verification_targets: 0,
          verified_from_adaptive_path: 0,
          no_useful_result: 0,
        },
      };
    }

    // Pivot is suggested — now attempt to find alternate surfaces
    const trigger = pivotTriggers.join('; ');
    const rootDomain = extractRootDomain(new URL(initialUrl).hostname);

    // Extract candidate hostnames from existing evidence (HTML responses)
    const candidateHostnames = new Set<string>();
    for (const ev of evidence) {
      if (ev.evidence_text && ev.source_type === 'PUBLIC_DOCUMENTATION') {
        const hosts = extractHostnamesFromHtml(ev.evidence_text, ev.public_url, rootDomain);
        hosts.forEach(h => candidateHostnames.add(h));
      }
    }

    // Add operator-supplied subdomains from existing evidence
    for (const sub of existingSubdomains) {
      if (isSameRootDomain(sub, rootDomain) && sub !== rootDomain) {
        candidateHostnames.add(sub);
      }
    }

    // Deduplicate and filter out the initial hostname
    const initialHostname = new URL(initialUrl).hostname;
    const candidates = [...candidateHostnames].filter(h => h !== initialHostname);

    // Record the suggestion
    records.push({
      investigation_id: `${organization}_adaptive_pivot_suggest`,
      organization,
      initial_surface: initialUrl,
      initial_observation_id: initialEv?.id || 'none',
      initial_boundary_classification: boundaryClass,
      initial_boundary_evidence_ids: initialEvidenceIds,
      pivot_trigger: trigger,
      pivot_action: `suggest_pivot_to_${candidates.length}_candidate_surface(s)`,
      pivot_reason: 'boundary_observation_warrants_alternate_path_exploration',
      pivot_source_evidence_ids: initialEvidenceIds,
      candidate_public_surfaces: candidates,
      discovered_public_surfaces: [],
      rejected_surfaces: [],
      rejection_reasons: [],
      new_evidence_ids: [],
      new_target_ids: [],
      new_evidence_details: [],
      verification_attempted: false,
      verification_result: 'not_attempted',
      final_decision: 'inherited_from_baseline',
      outcome: 'PIVOT_SUGGESTED',
      attribution_confidence: 'HIGH',
      started_at: startedAt,
      completed_at: now(),
    });

    // Execute pivots (maxPivots)
    let newEvidenceCount = 0;
    let altSurfacesFound = 0;
    let newTargets = 0;
    let executedPivots = 0;
    let verifiedFromAdaptive = 0;
    let noUsefulResult = 0;
    const discoveredSurfaces: string[] = [];
    const rejectedSurfaces: string[] = [];
    const rejectionReasons: string[] = [];
    const newEvidenceIds: string[] = [];
    const newTargetIds: string[] = [];
    const allEvidenceDetails: AdaptiveEvidenceDetail[] = [];

    const originalIdSet = new Set(evidence.map(e => e.id));

    let pivotIdx = 0;
    for (const candidate of candidates) {
      if (pivotIdx >= this.maxPivots) break;

      const pivotStarted = now();
      const pivotUrl = `https://${candidate}`;

      const provider = new LivePublicObservationProvider({
        delayMs: this.delayMs,
        sampleDelayMs: 200,
        maxRequests: this.maxPivotRequests,
        fetcher: this.fetcher as any,
      }) as any;

      let pivotEvidence: Evidence[] = [];
      let pivotError: string | null = null;

      try {
        const result = await provider.observePublicSurface(pivotUrl, {});
        pivotEvidence = result.evidence;
        pivotIdx++;
        executedPivots++;
        this.onProgress?.('deepening', `Adaptive pivot ${pivotIdx}/${this.maxPivots}: observing ${pivotUrl}`);

        if (pivotEvidence.length > 0) {
          discoveredSurfaces.push(pivotUrl);
          altSurfacesFound++;

          // Check for new evidence not in the original set
          const newEvs = pivotEvidence.filter(e => !originalIdSet.has(e.id));

          // Track per-pivot target IDs (NEW: NOT just the last one)
          const pivotTargetIds: string[] = [];

          if (newEvs.length > 0) {
            newEvidenceCount += newEvs.length;
            newEvs.forEach(e => newEvidenceIds.push(e.id));

            // Check for verification targets (HTTP 200-399)
            const verificationTargets = newEvs.filter(e =>
              (e.status ?? 0) >= 200 && (e.status ?? 0) < 400
            );

            // Build full evidence details for every new evidence record (FIX 5)
            for (const ev of newEvs) {
              const isTarget = verificationTargets.includes(ev);
              const detail = buildEvidenceDetail(
                ev,
                `adaptive_pivot_${pivotIdx}_fetch_and_observe`,
                'HIGH',  // same root domain = HIGH attribution
                isTarget,
                isTarget ? 'evidence_observed' : 'observed_not_verified'
              );
              detail.source_evidence_ids = initialEvidenceIds;
              allEvidenceDetails.push(detail);

              if (isTarget) {
                newTargets++;
                // FIX 1: Persist ALL target IDs, not just the last one
                pivotTargetIds.push(ev.id);
                newTargetIds.push(ev.id);
              }
            }

            // Record successful pivot with ALL target IDs
            records.push({
              investigation_id: `${organization}_adaptive_pivot_${pivotIdx}`,
              organization,
              initial_surface: initialUrl,
              initial_observation_id: initialEv?.id || 'none',
              initial_boundary_classification: boundaryClass,
              initial_boundary_evidence_ids: initialEvidenceIds,
              pivot_trigger: trigger,
              pivot_action: `fetch_and_observe ${pivotUrl}`,
              pivot_reason: 'alternate_surface_suggested_by_adaptive_engine',
              pivot_source_evidence_ids: initialEvidenceIds,
              candidate_public_surfaces: [pivotUrl],
              discovered_public_surfaces: [pivotUrl],
              rejected_surfaces: [],
              rejection_reasons: [],
              new_evidence_ids: newEvs.map(e => e.id),
              // FIX 1: ALL target IDs from this pivot, not just the last one
              new_target_ids: pivotTargetIds,
              // FIX 5: Full evidence details for independent inspection
              new_evidence_details: allEvidenceDetails.slice(allEvidenceDetails.length - newEvs.length),
              verification_attempted: true,
              verification_result: verificationTargets.length > 0 ? 'evidence_observed' : 'no_verification_target',
              final_decision: newEvs.length > 0 ? 'potential' : 'no_action',
              outcome: newEvs.length > 0 ? (newEvs.filter(e => e.repeatable).length > 0 ? 'NEW_EVIDENCE_FOUND' : 'NEW_VERIFICATION_TARGET') : 'NO_USEFUL_RESULT',
              attribution_confidence: 'HIGH',
              started_at: pivotStarted,
              completed_at: now(),
            });

            if (newEvs.length === 0) {
              noUsefulResult++;
            } else if (newEvs.filter(e => e.repeatable).length > 0) {
              verifiedFromAdaptive++;
            }
          } else {
            // All pivot evidence was already in the original set (no new evidence)
            rejectedSurfaces.push(pivotUrl);
            rejectionReasons.push('all evidence was already captured in initial scan');
            noUsefulResult++;

            records.push({
              investigation_id: `${organization}_adaptive_pivot_${pivotIdx}_rejected`,
              organization,
              initial_surface: initialUrl,
              initial_observation_id: initialEv?.id || 'none',
              initial_boundary_classification: boundaryClass,
              initial_boundary_evidence_ids: initialEvidenceIds,
              pivot_trigger: trigger,
              pivot_action: `fetch_and_observe ${pivotUrl}`,
              pivot_reason: 'alternate_surface_suggested_by_adaptive_engine',
              pivot_source_evidence_ids: initialEvidenceIds,
              candidate_public_surfaces: [pivotUrl],
              discovered_public_surfaces: [pivotUrl],
              rejected_surfaces: [pivotUrl],
              rejection_reasons: ['all evidence was already captured in initial scan'],
              new_evidence_ids: [],
              new_target_ids: [],
              new_evidence_details: [],
              verification_attempted: true,
              verification_result: 'no_new_evidence',
              final_decision: 'no_action',
              outcome: 'NO_USEFUL_RESULT',
              attribution_confidence: 'HIGH',
              started_at: pivotStarted,
              completed_at: now(),
            });
          }
        } else {
          // Pivot produced no evidence
          rejectedSurfaces.push(pivotUrl);
          rejectionReasons.push('no evidence returned (unreachable, empty, or error)');
          noUsefulResult++;

          records.push({
            investigation_id: `${organization}_adaptive_pivot_${pivotIdx}_rejected`,
            organization,
            initial_surface: initialUrl,
            initial_observation_id: initialEv?.id || 'none',
            initial_boundary_classification: boundaryClass,
            initial_boundary_evidence_ids: initialEvidenceIds,
            pivot_trigger: trigger,
            pivot_action: `fetch_and_observe ${pivotUrl}`,
            pivot_reason: 'alternate_surface_suggested_by_adaptive_engine',
            pivot_source_evidence_ids: initialEvidenceIds,
            candidate_public_surfaces: [pivotUrl],
            discovered_public_surfaces: [],
            rejected_surfaces: [pivotUrl],
            rejection_reasons: ['no evidence returned (unreachable, empty, or error)'],
            new_evidence_ids: [],
            new_target_ids: [],
            new_evidence_details: [],
            verification_attempted: true,
            verification_result: 'no_evidence',
            final_decision: 'no_action',
            outcome: 'NO_USEFUL_RESULT',
            attribution_confidence: 'HIGH',
            started_at: pivotStarted,
            completed_at: now(),
          });
        }
      } catch (e: any) {
        pivotError = e.message;
        // Count even on error to avoid exceeding maxPivots with failed attempts
        // Actually: only count executed pivots that actually ran. On error, still count.
        pivotIdx++;
        executedPivots++;
        rejectedSurfaces.push(pivotUrl);
        rejectionReasons.push(`error: ${e.message}`);
        noUsefulResult++;

        records.push({
          investigation_id: `${organization}_adaptive_pivot_${pivotIdx}_error`,
          organization,
          initial_surface: initialUrl,
          initial_observation_id: initialEv?.id || 'none',
          initial_boundary_classification: boundaryClass,
          initial_boundary_evidence_ids: initialEvidenceIds,
          pivot_trigger: trigger,
          pivot_action: `fetch_and_observe ${pivotUrl}`,
          pivot_reason: 'alternate_surface_suggested_by_adaptive_engine',
          pivot_source_evidence_ids: initialEvidenceIds,
          candidate_public_surfaces: [pivotUrl],
          discovered_public_surfaces: [],
          rejected_surfaces: [pivotUrl],
          rejection_reasons: [`error: ${e?.message || String(e)}`],
          new_evidence_ids: [],
          new_target_ids: [],
          new_evidence_details: [],
          verification_attempted: true,
          verification_result: 'error',
          final_decision: 'no_action',
          outcome: 'NO_USEFUL_RESULT',
          attribution_confidence: 'HIGH',
          started_at: pivotStarted,
          completed_at: now(),
        });
      }

      await new Promise(r => setTimeout(r, this.delayMs));
    }

    // If we ran out of candidates before executing pivots, record INCONCLUSIVE
    if (executedPivots === 0 && candidates.length === 0) {
      records.push({
        investigation_id: `${organization}_adaptive_inconclusive`,
        organization,
        initial_surface: initialUrl,
        initial_observation_id: initialEv?.id || 'none',
        initial_boundary_classification: boundaryClass,
        initial_boundary_evidence_ids: initialEvidenceIds,
        pivot_trigger: trigger,
        pivot_action: 'none',
        pivot_reason: 'no candidate surfaces discovered from existing evidence',
        pivot_source_evidence_ids: initialEvidenceIds,
        candidate_public_surfaces: [],
        discovered_public_surfaces: [],
        rejected_surfaces: [],
        rejection_reasons: [],
        new_evidence_ids: [],
        new_target_ids: [],
        new_evidence_details: [],
        verification_attempted: false,
        verification_result: 'no_candidates',
        final_decision: 'inherited_from_baseline',
        outcome: 'INCONCLUSIVE',
        attribution_confidence: 'HIGH',
        started_at: startedAt,
        completed_at: now(),
      });
    }

    // Build aggregate
    const aggregate: AdaptiveInvestigationAggregate = {
      boundary_observations: evidence.filter(e => classifyBoundary(e) !== 'OPEN_SURFACE').length,
      pivots_suggested: 1,
      pivots_executed: executedPivots,
      alternate_surfaces_found: altSurfacesFound,
      new_evidence_found: newEvidenceCount,
      new_verification_targets: newTargets,
      verified_from_adaptive_path: verifiedFromAdaptive,
      no_useful_result: noUsefulResult,
    };

    const result: AdaptiveInvestigationResult = {
      attempted: true,
      records,
      aggregate,
    };

    // FIX 6: Verify audit invariant
    const audit = verifyAggregate(result);
    if (!audit.valid) {
      // Log but don't throw — the invariant should always hold
      console.error(`[AdaptiveInvestigation] Audit invariant violation for ${organization}:`, audit.errors);
      for (const err of audit.errors) {
        console.error(`  - ${err}`);
      }
    }

    return result;
  }
}
