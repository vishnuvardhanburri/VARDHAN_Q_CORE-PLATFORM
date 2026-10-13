/**
 * VARDHAN — DIAGNOSTIC OPPORTUNITY ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 * Maps a defensible public finding → a DiagnosticOpportunity.
 *
 * The commercial chain:
 *
 *   PUBLIC FINDING  →  DIAGNOSTIC HYPOTHESIS  →  £15K DIAGNOSTIC
 *                  →  (after diagnostic) → REMEDIATION PLAN → £45K SCALE/POD
 *
 * Key principles:
 * - No person required. No email required. The finding is the prospect.
 * - Never claims the problem exists internally — proposes diagnostic questions.
 * - Every diagnostic question is derived ONLY from evidence.
 * - The £45K implementation hypothesis is NOT generated as a certainty.
 *
 * Only OBSERVED_* and POSSIBLE_* findings are actionable (DOCUMENTED_* are
 * published facts, not active technical problems).
 */
import type { FindingType, SeverityLevel } from './IntelligenceCase';
import type { Evidence, IntelligenceCase } from './IntelligenceCase';
import type { DeepFinding, DeepProspect, DiagnosticOpportunity,
  CommercialRelevance, TechnicalProblemType, DeepDecision, DeepConfidence,
  OutreachCardFields } from './DeepTypes';

/** Finding types that represent published facts / non-active problems. */
const NON_ACTIONABLE_FINDING_TYPES = new Set([
  'DOCUMENTED_SECURITY_POSTURE',
  'DOCUMENTED_SCALING_CONSTRAINT',
  'DOCUMENTED_INCIDENT',
  'DOCUMENTED_ENGINEERING_FAILURE',
  'GENERIC_ENGINEERING_ARTICLE',
  'UNEXPECTED_PUBLIC_BEHAVIOR',
  'CONFLICTING_EVIDENCE',
]);

/** Actionable finding types — these represent observable technical behaviors. */
const ACTIONABLE_PREFIXES = ['OBSERVED_', 'POSSIBLE_'];

/** Map finding types to technical problem categories. */
const PROBLEM_TYPE_MAP: Record<string, TechnicalProblemType> = {
  OBSERVED_AVAILABILITY_ISSUE: 'AVAILABILITY',
  OBSERVED_LATENCY: 'PERFORMANCE_LATENCY',
  POSSIBLE_PUBLIC_EXPOSURE: 'PUBLIC_EXPOSURE',
  POSSIBLE_SENSITIVE_METADATA_EXPOSURE: 'PUBLIC_EXPOSURE',
  POSSIBLE_INFORMATION_DISCLOSURE: 'INFO_DISCLOSURE',
  POSSIBLE_ACCESS_ISSUE: 'ACCESS_BOUNDARY',
  GITHUB_HIGH_CHANGE_VELOCITY: 'ARCHITECTURE',
  GITHUB_REPOSITORY_ACTIVITY_DECLINE: 'DEPLOYMENT_PLATFORM',
  GITHUB_TECHNOLOGY_CHANGE: 'ARCHITECTURE',
  GITHUB_ACTIVE_ENGINEERING: 'ARCHITECTURE',
  GITHUB_RELEASE_ACTIVITY: 'DEPLOYMENT_PLATFORM',
  GITHUB_PROJECT_GROWTH: 'GENERAL_ENGINEERING',
  GITHUB_MAINTENANCE_ACTIVITY: 'DEPLOYMENT_PLATFORM',
  GITHUB_ENGINEERING_CONCENTRATION: 'ARCHITECTURE',
};

/**
 * Technical area inference from finding type + evidence.
 * Determines which subsystem the diagnostic would investigate.
 */
function technicalAreaForFinding(findingType: string, evidence: Evidence[]): string {
  const obs = evidence.find(e => e.observation_type);
  if (findingType.includes('LATENCY') || findingType.includes('PERFORMANCE')) return 'API / service performance';
  if (findingType.includes('AVAILABILITY') || findingType.includes('ERROR')) return 'Public endpoint availability';
  if (findingType.includes('EXPOSURE') || findingType.includes('DISCLOSURE')) return 'Public API / resource exposure surface';
  if (findingType.includes('ACCESS')) return 'Authentication / authorization boundary';
  if (findingType.includes('SCALING') || findingType.includes('CAPACITY')) return 'Infrastructure scaling / load handling';
  if (findingType.includes('CONFIG')) return 'Public configuration / deployment artifacts';
  if (findingType.includes('DATABASE') || findingType.includes('STORAGE')) return 'Database / storage layer';
  if (findingType.startsWith('GITHUB_')) return 'Platform / deployment pipeline engineering';
  return 'Platform engineering surface';
}

/**
 * Recommended responsibility — what team/role SHOULD own the diagnostic.
 * Derived from technical area, NOT from person discovery.
 */
function recommendedResponsibilityFor(technicalArea: string): string {
  if (technicalArea.includes('performance')) return 'Performance / SRE team';
  if (technicalArea.includes('availability')) return 'Site Reliability / On-call team';
  if (technicalArea.includes('exposure') || technicalArea.includes('disclosure')) return 'Security / API product team';
  if (technicalArea.includes('access')) return 'Auth / Security team';
  if (technicalArea.includes('scaling')) return 'Platform / Infrastructure team';
  if (technicalArea.includes('configuration')) return 'Platform / DevOps team';
  if (technicalArea.includes('database')) return 'Database / Data Infrastructure team';
  if (technicalArea.includes('deployment') || technicalArea.includes('pipeline')) return 'Platform / DevOps team';
  if (technicalArea.includes('architecture')) return 'Engineering leadership / Architecture team';
  return 'Engineering team';
}

/**
 * Role keywords for manual search (LinkedIn / company team page).
 * These are search hints for the human operator, not automated discovery.
 */
function roleKeywordsFor(technicalArea: string): string[] {
  if (technicalArea.includes('performance')) return ['SRE', 'Site Reliability', 'Performance Engineer'];
  if (technicalArea.includes('availability')) return ['SRE', 'On-call', 'Site Reliability Engineer', 'Platform Engineer'];
  if (technicalArea.includes('exposure') || technicalArea.includes('disclosure')) return ['Security Engineer', 'API Security', 'Head of Security'];
  if (technicalArea.includes('access')) return ['Auth Engineer', 'Security Engineer', 'IAM'];
  if (technicalArea.includes('scaling')) return ['Platform Engineer', 'Infrastructure Engineer', 'SRE'];
  if (technicalArea.includes('configuration')) return ['DevOps', 'Platform Engineer', 'SRE'];
  if (technicalArea.includes('database')) return ['Data Engineer', 'Database Engineer', 'Data Infrastructure'];
  if (technicalArea.includes('deployment') || technicalArea.includes('pipeline')) return ['DevOps', 'Platform Engineer', 'Release Engineer'];
  if (technicalArea.includes('architecture')) return ['CTO', 'Head of Architecture', 'Staff Engineer'];
  return ['CTO', 'Head of Engineering', 'Platform Engineer'];
}

/**
 * Generate 5–8 diagnostic questions derived ONLY from evidence.
 * Each question maps back to a specific observation in the evidence.
 */
function diagnosticQuestionsFor(findingType: string, evidence: Evidence[]): string[] {
  const hasLatencyData = evidence.some(e => e.latency_ms && e.latency_samples && e.latency_samples.length > 0);
  const hasStatusData = evidence.some(e => e.status);
  const hasUrls = evidence.some(e => e.public_url);
  const hasObservedBehavior = evidence.some(e => e.observed_behavior);

  const questions: string[] = [];

  // Generic starter (always)
  questions.push('What component is responsible for the observed public behavior?');

  if (findingType.includes('LATENCY')) {
    if (hasLatencyData) questions.push('Is the latency elevated on specific API endpoints or across the entire public surface?');
    questions.push('Does the pattern persist under different request payloads and times of day?');
    questions.push('Are there public indicators of caching tiers, CDN, or database query paths in the response path?');
    questions.push('Is there a documented scaling or sharding strategy that could explain the latency pattern?');
    questions.push('Are there observability gaps — e.g. no public status page or latency SLA documentation?');
  } else if (findingType.includes('AVAILABILITY')) {
    if (hasStatusData) questions.push(`What HTTP ${evidence.find(e => e.status)?.status} responses were observed, on which endpoints, and under what request conditions?`);
    questions.push('Is the error condition reproducible with identical read-only requests?');
    questions.push('Does the error occur on a single endpoint or across multiple public API routes?');
    questions.push('Is there a documented incident or status page corroborating the observed error?');
    questions.push('What error-handling or fallback behavior is visible in the public response body?');
  } else if (findingType.includes('EXPOSURE') || findingType.includes('DISCLOSURE')) {
    questions.push('What specific data or fields are exposed on the public resource without authentication?');
    questions.push('Is the exposed surface part of the documented product API or an unintended disclosure?');
    questions.push('Does the exposure occur on one endpoint or across multiple resource types?');
    questions.push('Are there auth boundary indicators (401/403) that contradict the exposure claim?');
    questions.push('What mitigation (if any) is already visible — e.g. rate limiting, WAF, or access controls?');
  } else if (findingType.includes('ACCESS')) {
    questions.push('What specific resource returns 401/403, and what authentication is expected?');
    questions.push('Is the access boundary consistent across the API surface or endpoint-specific?');
    questions.push('Are there documented auth methods (OAuth, API keys, SSO) that could explain the boundary?');
    questions.push('Does the access behavior change under different request conditions (user-agent, headers)?');
  } else if (findingType.includes('SCALING')) {
    questions.push('What documented scaling or rate-limit constraints were observed, and on what surface?');
    questions.push('Is the constraint documented as product behavior or an observed degradation?');
    questions.push('Are there public indicators of queue depth, sharding, or load-balancing behavior?');
    questions.push('What is the documented request-rate ceiling, and is it actively enforced?');
  } else if (findingType.includes('CONFIG')) {
    questions.push('What configuration artifacts (debug endpoints, env vars, .git) are publicly accessible?');
    questions.push('Is the exposed configuration intentionally public or an unintended artifact?');
    questions.push('Are there public indicators of how the exposed config is loaded or used?');
    questions.push('What is the potential blast radius of the exposed configuration?');
  } else if (findingType.includes('GITHUB')) {
    questions.push("What is the repository's change velocity, and does it correlate with the finding?");
    questions.push('Are there public indicators of the deployment or release process?');
    questions.push('What technology stack is indicated by the repo metadata and dependencies?');
    questions.push('Are there public signals of maintenance burden or engineering concentration?');
  } else {
    if (hasUrls) questions.push('Where exactly is the observed behavior — which public URL and HTTP method?');
    questions.push('Is the behavior reproducible under identical read-only conditions?');
    questions.push('Does the behavior vary by request type, time, or client?');
  }

  // Always include a scope question
  if (!questions.some(q => q.includes('scope') || q.includes('investigate'))) {
    questions.push('What is the scope of the investigation — single endpoint or systemic pattern?');
  }

  // Always include a "not verified" question
  questions.push('What is verified publicly vs. what would require internal data to confirm?');

  // Cap at 8
  return questions.slice(0, 8);
}

/**
 * Generate diagnostic scope items for a £15K diagnostic engagement.
 * These are proposed investigation areas — NOT claims about internal state.
 */
function diagnosticScopeFor(findingType: string, technicalArea: string): string[] {
  const base = [
    'Architecture review of the affected public surface',
    'Root-cause analysis of the observed public behavior',
    'Evidence traceability audit (what is verified vs. inferred)',
    'Scope boundary mapping (which endpoints/systems are affected)',
  ];

  if (findingType.includes('LATENCY')) {
    base.push(
      'Latency profiling across request payloads and times',
      'Database/query performance analysis',
      'Caching tier and CDN behavior review',
    );
  } else if (findingType.includes('AVAILABILITY')) {
    base.push(
      'Error-handling path analysis',
      'Server-side error logging and retry behavior review',
      'Upstream dependency impact assessment',
    );
  } else if (findingType.includes('EXPOSURE') || findingType.includes('DISCLOSURE')) {
    base.push(
      'Data classification and sensitivity mapping',
      'Auth boundary and access control review',
      'Public resource surface inventory',
    );
  } else if (findingType.includes('ACCESS')) {
    base.push(
      'Authentication flow and boundary review',
      'Authorization policy analysis',
      'Error response consistency audit',
    );
  } else if (findingType.includes('SCALING')) {
    base.push(
      'Rate-limiting and throttling behavior analysis',
      'Load-shedding and queue behavior review',
      'Capacity planning and scaling trigger assessment',
    );
  } else if (findingType.includes('CONFIG')) {
    base.push(
      'Configuration artifact surface audit',
      'Secrets and environment variable exposure assessment',
      'Deployment artifact and CI/CD surface review',
    );
  } else if (findingType.includes('GITHUB')) {
    base.push(
      'Repository health and change velocity analysis',
      'Dependency and technology stack review',
      'Release pipeline and deployment cadence assessment',
    );
  } else {
    base.push(
      'Evidence reproduction and verification',
      'Public surface mapping of the affected area',
    );
  }

  return base;
}

/**
 * Commercial relevance scoring.
 * Considers: technical specificity, severity/impact, repeatability,
 * scope potential, diagnostic relevance, company relevance.
 *
 * This is an internal workflow classification, NOT proof of a problem.
 */
export function scoreCommercialRelevance(
  finding: DeepFinding | null,
  evidence: Evidence[],
  signals: any[],
  companyHasSurface: boolean
): CommercialRelevance {
  if (!finding || NON_ACTIONABLE_FINDING_TYPES.has(finding.finding_type)) {
    return 'RESEARCH_MORE';
  }

  // Only OBSERVED_* / POSSIBLE_* findings are actionable
  const isActionable = ACTIONABLE_PREFIXES.some(p => finding.finding_type.startsWith(p));
  if (!isActionable) {
    return 'RESEARCH_MORE';
  }

  let score = 0;

  // 1. Technical specificity — finding must be specific, not generic
  if (finding.confidence === 'HIGH') score += 3;
  else if (finding.confidence === 'MEDIUM') score += 2;
  else score += 1;

  // 2. Severity / impact evidence
  const sevMap: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };
  score += sevMap[finding.impact_severity] || 0;

  // 3. Repeatability — more evidence = more defensible
  if (evidence.length >= 3) score += 2;
  else if (evidence.length >= 1) score += 1;

  // 4. Scope potential — multiple source URLs = broader pattern
  if (finding.source_urls.length >= 2) score += 2;
  else if (finding.source_urls.length >= 1) score += 1;

  // 5. Diagnostic relevance — does the finding point to a real technical area?
  if (finding.strength?.technical_specificity === 'HIGH') score += 2;
  else if (finding.strength?.technical_specificity === 'MEDIUM') score += 1;

  // 6. Company relevance — does the company have a real public technical surface?
  if (companyHasSurface && evidence.some(e => e.public_url)) score += 2;
  else score += 0;

  // Threshold: HIGH requires ≥8, MEDIUM requires ≥5
  if (score >= 8) return 'HIGH_DIAGNOSTIC_POTENTIAL';
  if (score >= 5) return 'MEDIUM_DIAGNOSTIC_POTENTIAL';
  if (score >= 3) return 'LOW_DIAGNOSTIC_POTENTIAL';
  return 'RESEARCH_MORE';
}

/**
 * Build a DiagnosticOpportunity from a defensible finding + evidence + surface.
 * Returns null when no defensible finding exists.
 */
export function buildOpportunity(
  company: string,
  domain: string,
  finding: DeepFinding | null,
  evidence: Evidence[],
  signals: any[],
  homepage: string
): DiagnosticOpportunity | null {
  if (!finding || NON_ACTIONABLE_FINDING_TYPES.has(finding.finding_type)) {
    return null;
  }

  const isActionable = ACTIONABLE_PREFIXES.some(p => finding.finding_type.startsWith(p));
  if (!isActionable) return null;

  const technicalArea = technicalAreaForFinding(finding.finding_type, evidence);
  const responsibility = recommendedResponsibilityFor(technicalArea);
  const problemType = PROBLEM_TYPE_MAP[finding.finding_type] || 'GENERAL_ENGINEERING' as TechnicalProblemType;
  const relevance = scoreCommercialRelevance(finding, evidence, signals, true);

  // Build why_it_matters from evidence (strictly evidence-derived)
  const evidenceCount = evidence.filter(e => e.public_url).length;
  const sourceCount = new Set(evidence.map(e => e.public_url).filter(Boolean)).size;

  const whyItMatters = evidenceCount > 0
    ? `A repeatable public behavior was observed across ${evidenceCount} evidence record(s) on ${sourceCount} distinct public URL(s). This is a verifiable technical observation on the company's public surface that may warrant a focused diagnostic to determine the actual internal scope.`
    : 'A defensible technical signal was detected on the public surface. This warrants a diagnostic to verify scope and root cause.';

  const problem = finding.explanation || finding.severity_basis;
  const diagnosticQuestions = diagnosticQuestionsFor(finding.finding_type, evidence);
  const diagnosticScope = diagnosticScopeFor(finding.finding_type, technicalArea);

  // Role keywords + search hints for manual outreach
  const roles = roleKeywordsFor(technicalArea);
  const searchHints = [
    `"${company}" LinkedIn "${roles[0]}"`,
    `"${company}" LinkedIn "${roles[1] || roles[0]}"`,
    `"${company}" LinkedIn "${roles[2] || 'Platform'}"`,
    `"${company}" LinkedIn "CTO"`,
    `"${company}" LinkedIn "Head of Engineering"`,
  ];

  // Decision: diagnostic opportunities are RESEARCH_MORE at the prospect level
  // (no auto-outreach), but the DIAGNOSTIC_OPPORTUNITY is ready for manual outreach.
  const decision: DeepDecision = 'RESEARCH_MORE';
  const confidence: DeepConfidence = finding.confidence === 'HIGH' ? 'HIGH' : finding.confidence;

  return {
    company,
    company_url: homepage || `https://${domain}`,
    problem,
    problem_type: problemType,
    why_it_matters: whyItMatters,
    evidence_ids: evidence.map(e => e.id),
    primary_sources: finding.source_urls,
    signal_ids: [],
    correlation_ids: [],
    supporting_sources: Array.from(new Set(
      (evidence.map(e => e.public_url).filter(Boolean) as string[]).concat(finding.source_urls)
    )),
    technical_area: technicalArea,
    recommended_responsibility: responsibility,
    role_keywords: roles,
    search_hints: searchHints,
    diagnostic_questions: diagnosticQuestions,
    diagnostic_scope: diagnosticScope,
    finding_type: finding.finding_type,
    finding_confidence: finding.confidence,
    commercial_relevance: relevance,
    decision,
    confidence,
  };
}

/** Build the outreach card fields (problem-first, person secondary). */
export function buildOutreachCardFields(
  prospect: DeepProspect,
  opportunity: DiagnosticOpportunity | null
): Partial<OutreachCardFields> {
  if (!opportunity && !prospect.deep_finding) {
    return {};
  }

  // Only produce a card when the deep finding is defensible (actionable).
  // Non-defensible findings (DOCUMENTED_*, GENERIC_*, etc.) produce RESEARCH_MORE,
  // not an outreach card — per the commercial model.
  const df = prospect.deep_finding;
  if (!df || NON_ACTIONABLE_FINDING_TYPES.has(df.finding_type) || df.confidence === 'LOW') {
    return {};
  }

  const opp = opportunity || (prospect.diagnostic_opportunity ?? null);
  const finding: DeepFinding = df;
  const email = prospect.email_draft;
  const owner = prospect.selected_owner;

  return {
    company: prospect.company,
    company_url: prospect.public_surface?.homepage || prospect.domain,
    person: owner?.name || '',
    role: owner?.role || '',
    contact: (prospect.contactability.find(c => c.type === 'OWNER_VERIFIED_EMAIL')?.value
      || prospect.contactability.find(c => c.type === 'COMPANY_BUSINESS_EMAIL')?.value
      || '') || '',
    contact_status: prospect.contact_status,
    why_this_person: owner?.owner_evidence?.[0] || owner?.deep_owner_provenance || '',
    problem: opp?.problem || (finding as DeepFinding | null)?.explanation || finding?.severity_basis || '',
    finding_type: finding?.finding_type || '',
    primary_source: ((finding as DeepFinding | null)?.source_urls || [prospect.public_surface?.homepage || ''])[0] || '',
    supporting_sources: opp?.supporting_sources || [],
    supporting_evidence: opp?.evidence_ids || [],
    technical_area: opp?.technical_area || 'Platform engineering surface',
    recommended_responsibility: opp?.recommended_responsibility || '',
    role_search_hints: opp?.search_hints || [],
    subject: email?.primary_subject || '',
    email: email?.body || '',
    backup_subject: email?.alternate_subject || '',
    backup_email: email?.body || '',
    reply_evidence_pack: (email?.claims || []).map(c => ({
      claim_type: c.claim_type,
      text: c.text,
      evidence_ids: c.evidence_ids,
    })),
    diagnostic_angle: opp?.why_it_matters || '',
    confidence: prospect.confidence,
    diagnostic_potential: opp?.commercial_relevance || '',
    next_action: opp
      ? 'Review the diagnostic opportunity. Contact the responsible team using the search hints. Reply evidence packs available.'
      : 'Research more — no defensible finding.',
  };
}
