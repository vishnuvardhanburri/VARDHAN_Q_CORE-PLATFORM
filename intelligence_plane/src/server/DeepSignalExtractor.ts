/**
 * VARDHAN — DEEP SIGNAL EXTRACTOR (additive)
 * ─────────────────────────────────────────────────────────────────────────────
 * Extracts structured technical SIGNALS from the bounded public surface that
 * PublicLinkDiscovery already discovered. It does NOT perform any classification
 * that the core engine owns (finding/evidence/owner/email) — it produces
 * additional structured context used by the ICP qualification and email layers.
 *
 * Signals are conservative: a signal is only emitted when an explicit keyword
 * or structured public resource is observed on a page. Generic engineering
 * prose is never turned into an active problem here.
 */

import type { DeepSignal, SignalSourceType, EvidenceProvenance, SignalStrength, DeepStage } from './DeepTypes';
import type { Evidence, DiscoveredPage, CompanySurface, SourceRelationship } from './IntelligenceCase';

/**
 * Incident context classification — determines the semantic polarity of a
 * keyword match. A match for "downtime" in "no downtime" is NEGATED, not
 * an actual incident signal.
 */
export type IncidentContext =
  | 'POSITIVE'           // Genuine incident: "service experienced downtime"
  | 'NEGATED'           // Negated: "no downtime", "zero downtime"
  | 'HISTORICAL'        // Past event: "experienced an outage last month"
  | 'RESOLVED'          // Resolved: "incident was resolved", "recovered"
  | 'HYPOTHETICAL'      // Hypothetical: "could cause downtime"
  | 'INSTRUCTIONAL'     // Instructional: "prevent downtime", "avoid outages"
  | 'CURRENT';          // Current ongoing issue: "degraded service"

const NEGATION_WORDS = [
  /\bno\s+(?:downtime|outage|degrad|errors?|issues?|impact|incident|problems?|failure|interruption)s?\b/gi,
  /\bnot\s+(?:experience|have|caus|impact|affected|affected|encounter|see|lead|result|affected)\w*\b/gi,
  /\bwithout\s+(?:downtime|outage|degrad|errors?|impact|interruption)\b/gi,
  /\bnever\s+(?:downtime|outage|degrad|experience|had|encounter)\w*\b/gi,
  /\bzero\s*-?\s*downtime\b/gi,
  /\bzero\s*-?\s*outage\b/gi,
  /\bzero\s*-?\s*degradation\b/gi,
  /\bno\s+downtime\b/gi,
  /\bnegat/i,
  /\bprevents?\s+(?:downtime|outage|degrad|errors?|impact|interruption)\b/gi,
  /\bpreventing\s+(?:downtime|outage|degrad|errors?|impact|interruption)\b/gi,
  /\bprevent\s+(?:downtime|outage|degrad|errors?|impact|interruption)\b/gi,
  /\bavoids?\s+(?:downtime|outage|degrad|errors?|impact|interruption)\b/gi,
  /\bresilient/i, /\bresilience\b/gi,
  /\bmitigat/i,
  /\bprotects?\s+against\b/gi, /\bprotection\b/gi,
  /\bsafe\b/gi, /\bsafety\b/gi,
  /\breliab/i,
  /\bhighly\s+available\b/gi, /\bhigh\s+availability\b/gi,
  /\bguarantee\b/gi, /\bguaranteed\b/gi,
  // Generic "no" before incident keyword
  /\bno\s+(outage|degradation|incident|downtime|degrad)\b/gi,
];

// Negation context — check for negation words within the raw match window
const NEGATION_CONTEXT_PATTERN = /\b(no\s+(?:downtime|outage|degrad|errors?|impact|interruption|incident|problems?|failure)|not\s+(?:experience|have|caus|impact|affected|affected)|without\s+(?:downtime|outage|degrad|errors?)|never\s+(?:downtime|outage|degrad|experience|had)|zero\s*-?\s*downtime|zero\s*-?\s*outage|prevent\s+(?:downtime|outage|degrad|errors?)|avoid\s+(?:downtime|outage|degrad|errors?)|mitigat|resilien|no\s+outage|no\s+degradation|no\s+downtime|no\s+incident)\b/gi;

const RESOLVED_WORDS = [
  /\bresolved\b/gi, /\brecovered\b/gi, /\bfixed\b/gi, /\brestored\b/gi,
  /\brecovered?\s+from\b/gi, /\brestored?\s+to\b/gi, /\bback\s+up\b/gi,
  /\brecovered\s+by\b/gi, /\brestored\s+by\b/gi,
];

const HISTORICAL_WORDS = [
  /\blast\s+(?:month|week|year|day)\b/gi, /\bpast\b/gi, /\bpreviously\b/gi,
  /\bprior\s+to\b/gi, /\bhistorically\b/gi, /\bpreviously\s+experienced\b/gi,
];

const HYPOTHETICAL_WORDS = [
  /\bcould\s+/gi, /\bmight\s+/gi, /\bmay\s+/gi, /\bwould\s+/gi,
  /\bpotential(ly)?\b/gi, /\brisk\b/gi, /\bthreaten\b/gi,
];

/**
 * Analyze the semantic context around a detector match.
 * Inspects a bounded window before and after the keyword to determine
 * polarity: POSITIVE, NEGATED, HISTORICAL, RESOLVED, HYPOTHETICAL, etc.
 */
export function analyzeIncidentContext(rawMatch: string, signalType: SignalSourceType): IncidentContext {
  if (signalType !== 'PUBLIC_INCIDENT' && signalType !== 'STATUS_PAGE') {
    return 'CURRENT';
  }

  const text = rawMatch.toLowerCase();

  // Check for negation within ±80 chars of any incident keyword
  // (the raw_match is typically a sentence around the match)
  for (const neg of NEGATION_WORDS) {
    if (neg.test(text)) return 'NEGATED';
  }

  // Check for resolved/historical markers
  for (const res of RESOLVED_WORDS) {
    if (res.test(text)) return 'RESOLVED';
  }

  for (const hist of HISTORICAL_WORDS) {
    if (hist.test(text)) return 'HISTORICAL';
  }

  for (const hyp of HYPOTHETICAL_WORDS) {
    if (hyp.test(text)) return 'HYPOTHETICAL';
  }

  // Check if this is describing a preventive measure (instructional)
  if (/\b(prevent|avoid|mitigate|reduce|eliminate|design for|built to|ensures?|guarantees?)\s+(downtime|outage|degrad|interruption)/gi.test(text)) {
    return 'INSTRUCTIONAL';
  }

  return 'POSITIVE';
}

type SignalDetector = {
  type: SignalSourceType;
  provenance: (cat: string | undefined, isStatusPage: boolean) => EvidenceProvenance;
  strength: (cat: string | undefined) => SignalStrength;
  regex: RegExp;
  relevance: string;
};

const DETECTORS: SignalDetector[] = [
  {
    type: 'PUBLIC_INCIDENT',
    regex: /\b(?:major|partial|service)?\s*outage\b|\bindent report\b|\bindent\b|degraded service|service interruption|postmortem\b|post-mortem\b|downtime|\bresolved\s+(?:the\s+)?incident\b/i,
    provenance: (_cat, isStatus) => isStatus ? 'REAL_PUBLIC_OBSERVATION' : 'DOCUMENTED_FACT',
    strength: (cat) => (cat === 'status_ops' || cat === 'blog' || cat === 'engineering') ? 'HIGH' : 'MEDIUM',
    relevance: 'Publicly documented incident / outage / service degradation.'
  },
  {
    type: 'STATUS_PAGE',
    regex: /\ball systems (?:operational|normal)\b|status page|real-time status|system status|availability status|monitoring our services/i,
    provenance: (cat) => cat === 'status_ops' ? 'REAL_PUBLIC_OBSERVATION' : 'DOCUMENTED_FACT',
    strength: (cat) => (cat === 'status_ops') ? 'MEDIUM' : 'LOW',
    relevance: 'Public observability / status surface is published.'
  },
  {
    type: 'TECHNICAL_HIRING',
    regex: /\b(?:we'?re?\s*)?hiring\b|\bjoin (?:our|the) (?:engineering|platform|infra(?:structure)?|SRE|security)\b|\btechnical\s*(?:role|position|opening)\b|\bopen\s*(?:eng|sw|infra|platform|sre|security)\b/i,
    provenance: () => 'DOCUMENTED_FACT',
    strength: (cat) => (cat === 'hiring' || cat === 'engineering' || cat === 'careers') ? 'HIGH' : 'MEDIUM',
    relevance: 'Public technical hiring signal (engineer-facing organization).'
  },
  {
    type: 'API_REFERENCE',
    regex: /\bAPI\s*reference\b|\bREST\s*API\b|\bGraphQL\s*API\b|\bwebhooks?\b|\bOpenAPI\b|\bswagger\b|\bclient\s*library\b|\/v\d+\/|\bSDK\b|\bDeveloper\s*portal\b/i,
    provenance: () => 'DOCUMENTED_FACT',
    strength: (cat) => (cat === 'developers' || cat === 'docs' || cat === 'api') ? 'HIGH' : 'MEDIUM',
    relevance: 'Public API / developer platform surface.'
  },
  {
    type: 'ARCHITECTURE_DISCUSSION',
    regex: /\bmicroservices?\b|\bkubernetes\b|\bk8s\b|\bAWS\b|\bamazon web services\b|\bgoogle cloud\b|\bgcp\b|\bazure\b|\bcloud-native\b|\bcontainers?\b|\bdocker\b|\bterraform\b|\bre-platforming\b|\breplatformed\b|\barchitecture\b/i,
    provenance: (cat) => (cat === 'engineering' || cat === 'docs' || cat === 'technology') ? 'DOCUMENTED_FACT' : 'VARDHAN_INFERENCE',
    strength: (cat) => (cat === 'engineering' || cat === 'docs' || cat === 'technology') ? 'HIGH' : 'LOW',
    relevance: 'Publicly stated architecture / infrastructure stack.'
  },
  {
    type: 'SECURITY_PAGE',
    regex: /\bSOC\s*2\b|\bISO\s*27001\b|\bpci\s*dss\b|\bhipaa\b|\bpenetration\s*test\b|\bbug\s*bounty\b|\bvulnerability\s*disclosure\b|\bencryption\s*at\s*rest\b|\bprivacy\s*shield\b|\bCSA\s*STAR\b/i,
    provenance: (cat) => cat === 'security' ? 'DOCUMENTED_FACT' : 'VARDHAN_INFERENCE',
    strength: (cat) => (cat === 'security') ? 'HIGH' : 'LOW',
    relevance: 'Public security / compliance posture mention.'
  },
  {
    type: 'ENGINEERING_ARTICLE',
    regex: /\bscaling\b|\bsharded\b|\bpartitioned\b|\bmillions of\b|\bthroughput\b|\bhandle\s+\d{3,}\b|\breliability\b|\bplatform\b|\binfra\b/i,
    provenance: () => 'VARDHAN_INFERENCE',
    strength: () => 'LOW',
    relevance: 'Operational scale / reliability discussion (inferred).'
  },
  {
    type: 'BLOG',
    regex: /engineering blog|tech blog|inside (?:our|the) engineering|from the (?:engineering|platform)/i,
    provenance: () => 'DOCUMENTED_FACT',
    strength: (cat) => (cat === 'blog' || cat === 'engineering') ? 'MEDIUM' : 'LOW',
    relevance: 'Company maintains an engineering-facing blog.'
  }
];

/** Simple stable hash for signal IDs. */
function hash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36).slice(0, 6);
}

function textOf(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Return the sentence/segment around the first match, length-capped. */
function sentenceAround(text: string, keyword: string, cap = 200): string {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx < 0) return text.slice(0, cap);
  let start = text.lastIndexOf('.', idx - 1);
  start = start < 0 ? 0 : start + 1;
  let end = text.indexOf('.', idx + keyword.length);
  end = end < 0 ? text.length : end + 1;
  const seg = text.slice(start, end).trim();
  return seg.length > cap ? seg.slice(0, cap) + '…' : seg;
}

function publishedAt(html: string): string | undefined {
  const time = /<time[^>]+datetime=["']([^"']+)["']/i.exec(html);
  if (time) return time[1];
  const meta = /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (meta) return meta[1];
  return undefined;
}

export interface SignalExtractorOptions {
  onProgress?: (stage: DeepStage, message: string) => void;
}

export interface SignalCandidate {
  id: string;
  type: SignalSourceType;
  source_url: string;
  raw_match: string;
  initial_strength: SignalStrength;
  evidence_ids: string[];
  qualification_gaps: string[];
  provenance: EvidenceProvenance;
  category: string | undefined;
  /** Semantic context of the match (e.g., NEGATED for "no downtime"). */
  incident_context?: IncidentContext;
}

export class DeepSignalExtractor {
  /**
   * Build structured signal candidates from a set of observations.
   * Stage 1: Evidence -> SignalCandidate
   */
  static extractCandidates(
    observations: any[],
    observationEvidence: Evidence[] = [],
    options: { onCandidate: (cand: SignalCandidate | null, obs: any, mapping: SignalSourceType | null) => void } = { onCandidate: () => {} }
  ): SignalCandidate[] {
    const candidates: SignalCandidate[] = [];
    const evidenceByUrl = new Map<string, Evidence[]>();
    for (const ev of observationEvidence) {
      if (!ev.public_url) continue;
      const k = ev.public_url.replace(/\/$/, '') || ev.public_url;
      const arr = evidenceByUrl.get(k) || [];
      arr.push(ev);
      evidenceByUrl.set(k, arr);
    }

    for (const obs of observations) {
      const mapped = this.mapObservationToSignalType(obs.type, obs.raw_text || obs.text || '');

      if (!mapped) {
        options.onCandidate(null, obs, null);
        continue;
      }

      const signalType = mapped.type;
      const detector = mapped.detector;

      const relatedEvidence = evidenceByUrl.get(obs.url || '') || [];

      // IDENTITY GUARD: Filter out unverified evidence (Quarantine)
      // Only quarantine when there IS evidence but it's all unverified.
      // When no evidence exists, the observation itself is the evidence.
      const verifiedEvidence = relatedEvidence.filter(e => e.relationship_type !== 'UNVERIFIED');
      if (relatedEvidence.length > 0 && verifiedEvidence.length === 0) {
        options.onCandidate(null, obs, signalType);
        continue;
      }

      const relatedIds = verifiedEvidence.map(e => e.id);

      // Initial strength based on evidence strength, or default based on detector
      let strength: SignalStrength = 'LOW';
      if (verifiedEvidence.length > 0) {
        if (verifiedEvidence.some(e => e.strength === 'CRITICAL')) strength = 'HIGH';
        else if (verifiedEvidence.some(e => e.strength === 'HIGH')) strength = 'MEDIUM';
        else if (verifiedEvidence.some(e => e.strength === 'MEDIUM')) strength = 'LOW';
      } else if (detector) {
        strength = detector.strength(obs.category);
      }

      // Provenance from detector, or default
      const provenance = detector ? detector.provenance(obs.category, false) : 'REAL_PUBLIC_OBSERVATION';

      // Semantic context analysis — especially critical for incident keywords.
      // "no downtime", "zero downtime deployment", "prevent outages" must NOT
      // become PUBLIC_INCIDENT signals.
      const rawMatchText = obs.raw_text || obs.text || '';
      const incidentContext = analyzeIncidentContext(rawMatchText, signalType);

      const candidate: SignalCandidate = {
        id: `cand_${signalType}_${hash(obs.url || Math.random().toString())}`,
        type: signalType,
        source_url: obs.url || 'unknown',
        raw_match: rawMatchText,
        initial_strength: strength,
        evidence_ids: relatedIds,
        qualification_gaps: [],
        provenance: provenance as any,
        category: obs.category,
        incident_context: incidentContext,
      };

      candidates.push(candidate);
      options.onCandidate(candidate, obs, signalType);
    }

    return candidates;
  }

  /**
   * Promote candidates to qualified signals.
   * Stage 2: SignalCandidate -> QualifiedSignal (DeepSignal)
   *
   * QUALIFICATION GATES:
   * 1. Must have matching evidence (by URL) when evidence_ids are declared.
   * 2. Evidence-backed: must have HIGH/CRITICAL/MEDIUM strength OR corroborating
   *    evidence from >=2 source types.
   * 3. Evidence-free candidates: must demonstrate technical specificity — the
   *    matched text must contain substantive technical language beyond a single
   *    generic keyword. This prevents navigation noise ("AI SDK", "Platform",
   *    "Security") from auto-qualifying as signals.
   */
  static qualify(
    candidates: SignalCandidate[],
    observationEvidence: Evidence[],
    companyName: string = '',
    options: { onQualification: (res: 'QUALIFIED' | 'REJECTED') => void } = { onQualification: () => {} }
  ): DeepSignal[] {
    const qualified: DeepSignal[] = [];

    for (const cand of candidates) {
      const evidence = observationEvidence.filter(e => cand.evidence_ids.includes(e.id));

      // Gate 1: Must have evidence when evidence_ids are declared.
      if (evidence.length === 0 && cand.evidence_ids.length > 0) {
        cand.qualification_gaps.push('MISSING_PROVENANCE');
        options.onQualification('REJECTED');
        continue;
      }

      // Gate 2: All candidates must demonstrate technical specificity.
      const specificity = assessSpecificity(cand.raw_match, cand.type);
      if (!specificity.isSpecific) {
        cand.qualification_gaps.push(specificity.reason);
        options.onQualification('REJECTED');
        continue;
      }

      // Gate 3: Evidence-backed candidates must meet strength/corroboration.
      if (evidence.length > 0) {
        const hasHighStrength = evidence.some(e => e.strength === 'HIGH' || e.strength === 'CRITICAL');
        const hasMediumStrength = evidence.some(e => e.strength === 'MEDIUM');
        const hasMultipleSources = new Set(evidence.map(e => e.source_type)).size >= 2;

        if (!hasHighStrength && !hasMediumStrength && !hasMultipleSources) {
          cand.qualification_gaps.push('INSUFFICIENT_STRENGTH_OR_CORROBORATION');
          options.onQualification('REJECTED');
          continue;
        }
      }

      // Gate 4: Semantic negation check for incident signals.
      const ctx = cand.incident_context;
      if (cand.type === 'PUBLIC_INCIDENT' && ctx && ctx !== 'POSITIVE' && ctx !== 'HISTORICAL' && ctx !== 'RESOLVED' && ctx !== 'CURRENT') {
        cand.qualification_gaps.push(`SEMANTIC_NEGATION:${ctx}`);
        options.onQualification('REJECTED');
        continue;
      }

      // Promote to DeepSignal
      qualified.push({
        signal_id: `sig_${cand.id}`,
        type: cand.type,
        source_url: cand.source_url,
        excerpt: cand.raw_match,
        provenance: cand.provenance as any,
        signal_strength: cand.initial_strength,
        relevance: `Qualified signal of type ${cand.type} based on verified evidence.`,
        related_evidence_ids: cand.evidence_ids,
      });
      options.onQualification('QUALIFIED');
    }

    return qualified;
  }

  private static mapObservationToSignalType(obsType: string, text: string = ''): { type: SignalSourceType; detector: SignalDetector | null } | null {
    const mapping: Record<string, SignalSourceType> = {
      'incident': 'PUBLIC_INCIDENT',
      'system_health': 'STATUS_PAGE',
      'SRE_hiring': 'TECHNICAL_HIRING',
      'tech_stack_requirement': 'ARCHITECTURE_DISCUSSION',
      'ARCHITECTURE_SHIFT': 'ARCHITECTURE_DISCUSSION',
      'SCALING_PAIN': 'ARCHITECTURE_DISCUSSION',
      'RELIABILITY_HINT': 'PUBLIC_INCIDENT',
      'INFRA_LIMITATION': 'ARCHITECTURE_DISCUSSION',
    };

    // If obsType is already a SignalSourceType (from detector-based extraction),
    // return it directly — do NOT re-run regex matching which could yield a
    // different (less specific) signal type.
    const signalTypes: SignalSourceType[] = ['PUBLIC_INCIDENT', 'STATUS_PAGE', 'TECHNICAL_HIRING', 'API_REFERENCE', 'ARCHITECTURE_DISCUSSION', 'SECURITY_PAGE', 'ENGINEERING_ARTICLE', 'BLOG', 'TECHNICAL_DOCUMENTATION', 'SDK_DOCS', 'NEWS'];
    if (signalTypes.includes(obsType as SignalSourceType)) {
      const detector = DETECTORS.find(d => d.type === obsType) || null;
      return { type: obsType as SignalSourceType, detector };
    }

    if (mapping[obsType]) {
      const detector = DETECTORS.find(d => d.type === mapping[obsType]) || null;
      return { type: mapping[obsType], detector };
    }

    for (const detector of DETECTORS) {
      if (detector.regex.test(text)) return { type: detector.type, detector };
    }

    return null;
  }

  static extract(
    observations: any[],
    observationEvidence: Evidence[] | Map<string, string> = [],
    existingEvidence: Evidence[] = [],
    currentCompany: string = '',
    opts: { onProgress?: (stage: string, msg: string) => void } = {}
  ): DeepSignal[] {
    // If the second arg is a Map (htmlByUrl), extract text from HTML and build
    // observations. Per-page, at most 2 distinct signal types are emitted
    // (highest-priority first). This allows genuinely different technical
    // facts from the same page (e.g., STATUS_PAGE + TECHNICAL_HIRING) while
    // preventing navigation-keyword fan-out (8 detectors matching a nav bar).
    let obsList: any[] = observations;
    if (observationEvidence instanceof Map) {
      obsList = [];
      const priority: SignalSourceType[] = [
        'PUBLIC_INCIDENT', 'STATUS_PAGE', 'SECURITY_PAGE', 'ARCHITECTURE_DISCUSSION',
        'TECHNICAL_HIRING', 'API_REFERENCE', 'ENGINEERING_ARTICLE', 'BLOG',
      ];
      for (const obs of observations) {
        const html = observationEvidence.get(obs.url);
        if (html) {
          const text = textOf(html);
          const matches: { detector: SignalDetector; match: RegExpExecArray; priority: number }[] = [];
          for (const detector of DETECTORS) {
            const m = detector.regex.exec(text);
            if (m) {
              const p = priority.indexOf(detector.type);
              if (p >= 0) {
                matches.push({ detector, match: m, priority: p });
              }
            }
          }
          // Sort by priority (highest = lowest number = most critical)
          matches.sort((a, b) => a.priority - b.priority);
          // Emit at most 3 distinct types per page (highest-priority first)
          for (let i = 0; i < Math.min(matches.length, 3); i++) {
            const { detector, match } = matches[i];
            obsList.push({
              url: obs.url,
              type: detector.type,
              raw_text: sentenceAround(text, match[0]),
              source_url: obs.url,
              category: obs.category,
            });
          }
        }
      }
    }

    const evidenceArr = Array.isArray(observationEvidence) ? observationEvidence : [];
    const finalEvidence = [...evidenceArr, ...(Array.isArray(existingEvidence) ? existingEvidence : [])];

    let observations_received = 0;
    let signal_mapping_success = 0;
    let candidates_created = 0;
    let candidates_rejected = 0;
    let candidates_qualified = 0;
    let signals_stored = 0;

    const candidates = this.extractCandidates(obsList, finalEvidence, {
      onCandidate: (cand, obs, mapping) => {
        observations_received++;
        if (mapping) signal_mapping_success++;
        if (cand) candidates_created++;
      }
    });

    // Deduplicate candidates by (source_url, type) — collapse semantically
    // identical signals from the same observation.
    const seen = new Set<string>();
    const deduped: SignalCandidate[] = [];
    for (const c of candidates) {
      const key = c.source_url + '|' + c.type;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(c);
      }
    }

    const qualified = this.qualify(deduped, finalEvidence, currentCompany, {
      onQualification: (res) => {
        if (res === 'REJECTED') candidates_rejected++;
        else if (res === 'QUALIFIED') candidates_qualified++;
      }
    });

    signals_stored = qualified.length;

    opts.onProgress?.('signal_summary',
      `Promotion: ${observations_received} observations → ${candidates_created} candidates → ${candidates_created - deduped.length} deduplicated → ${qualified.length} qualified signals.`);

    return qualified;
  }

  static splitByProvenance(signals: DeepSignal[]): {
    documented_facts: DeepSignal[];
    public_observations: DeepSignal[];
    inferences: DeepSignal[];
  } {
    const out = { documented_facts: [] as DeepSignal[], public_observations: [] as DeepSignal[], inferences: [] as DeepSignal[] };
    for (const s of signals) {
      if (s.provenance === 'DOCUMENTED_FACT') out.documented_facts.push(s);
      else if (s.provenance === 'REAL_PUBLIC_OBSERVATION') out.public_observations.push(s);
      else out.inferences.push(s);
    }
    return out;
  }
}

/**
 * Assess whether a raw_match text represents genuine technical specificity
 * or just a generic keyword from navigation/boilerplate.
 *
 * Evidence-free candidates (from HTML regex detection) must pass this check
 * to become qualified signals. Generic observations like "HTTP 200 observed"
 * or navigation text containing "AI SDK / Platform / Security" do NOT qualify
 * unless the surrounding text demonstrates actual technical meaning.
 */
function assessSpecificity(rawText: string, signalType: SignalSourceType): { isSpecific: boolean; reason: string } {
  const text = (rawText || '').toLowerCase().trim();
  if (!text || text.length < 15) return { isSpecific: false, reason: 'INSUFFICIENT_SPECIFICITY' };

  // Pure HTTP status observations never produce signals
  if (/^http \d{3} observed/.test(text)) return { isSpecific: false, reason: 'GENERIC_HTTP_STATUS_NO_TECHNICAL_CONTENT' };

  // Navigation/boilerplate patterns that should NEVER produce signals
  const navPatterns = [
    'skip to content', 'copy wordmark', 'download brand assets',
    'brand guidelines', 'sign in', 'get started', 'learn more',
    'cookie policy', 'privacy policy', 'terms of service',
    '© ', 'all rights reserved',
  ];
  // If the text is almost ENTIRELY navigation (no substantive technical content),
  // reject it. We allow a few nav patterns if accompanied by technical terms.
  let navHits = 0;
  for (const p of navPatterns) { if (text.includes(p)) navHits++; }
  if (navHits >= 2) return { isSpecific: false, reason: 'GENERIC_NAVIGATION_TEXT' };

  // Substantive technical infrastructure terms — these are genuine technical
  // facts when mentioned, not generic marketing. A single mention is sufficient.
  const substantiveTerms = [
    'kubernetes', 'k8s', 'microservice', 'microservices', 'terraform',
    'docker', 'containers', 'containers', 'redis', 'postgres', 'mysql',
    'cassandra', 'mongodb', 'mongodb', 'elasticsearch', 'kafka', 'rabbitmq',
    'aws', 'amazon web services', 'google cloud', 'gcp', 'azure', 'cloud-native',
    'service mesh', 'sharded', 'partitioned', 'distributed',
    'outage', 'degraded', 'postmortem', 'soc 2', 'iso 27001', 'pci dss',
    'encryption at rest', 'bug bounty', 'vulnerability disclosure',
    'site reliability', 'sre', 'terraform', 'distributed systems',
  ];
  const hasSubstantiveTerm = substantiveTerms.some(term => text.includes(term));
  if (hasSubstantiveTerm) return { isSpecific: true, reason: 'SPECIFIC_TECHNICAL_CONTENT' };

  // Type-specific technical vocabulary requirements.
  // For these, a single substantive term is sufficient (e.g., "Available on AWS").
  const typeVocab: Record<string, string[]> = {
    'API_REFERENCE': ['endpoint', 'request', 'response', 'parameter', 'authentication', 'api key', 'rate limit', 'graphql', 'rest api', 'webhook', 'developer portal'],
    'ENGINEERING_ARTICLE': ['served', 'serving', 'requests per', 'throughput', 'latency', 'database', 'sharded', 'partition', 'cluster', 'node', 'instance', 'deployment', 'migration', 'scaling', 'capacity', 'peak', 'millions of'],
    'ARCHITECTURE_DISCUSSION': ['deployed', 'infrastructure', 'migration', 'system', 'service', 'container', 'orchestrat', 'mesh', 'pipeline', 'stack', 'runtime', 'compute', 'storage', 'network'],
    'SECURITY_PAGE': ['soc 2', 'iso 27001', 'pci', 'hipaa', 'encryption', 'compliance', 'audit', 'vulnerability', 'bug bounty', 'penetration', 'security assessment'],
    'STATUS_PAGE': ['operational', 'degraded', 'incident', 'outage', 'availability', 'uptime', 'real-time', 'monitoring', 'downtime'],
    'TECHNICAL_HIRING': ['sre', 'site reliability', 'platform engineer', 'infrastructure engineer', 'distributed systems'],
    'PUBLIC_INCIDENT': ['outage', 'degraded', 'downtime', 'interruption', 'service issue', 'postmortem', 'resolved', 'mitigated'],
    'BLOG': ['engineering', 'architecture', 'scalability', 'performance', 'system design', 'technical deep', 'infrastructure'],
  };

  const requiredTerms = typeVocab[signalType as string] || [];
  const hasTypeVocab = requiredTerms.some(term => text.includes(term.toLowerCase()));
  if (hasTypeVocab) return { isSpecific: true, reason: 'SPECIFIC_TECHNICAL_CONTENT' };

  // Generic terms like "SDK", "Platform", "API" in navigation context
  // are NOT sufficient without substantive technical context.
  return { isSpecific: false, reason: 'GENERIC_OBSERVATION_NO_SPECIFICITY' };
}

/** Simple stable hash for signal IDs. */
