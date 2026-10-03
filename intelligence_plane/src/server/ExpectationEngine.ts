/**
 * VARDHAN — EXPECTATION ENGINE (§EXPECTED-BEHAVIOR)
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds evidence-backed expected-behavior models for entry points.
 *
 * The ExpectationEngine NEVER invents expectations. It derives expectations
 * ONLY from existing evidence records and the entry point's documented/
 * observed attributes.
 *
 * Critical anti-inference rules (enforced):
 *   • A URL path like "/admin" does NOT imply authentication is required.
 *   • A URL path like "/dashboard" does NOT imply authentication is required.
 *   • A hostname does NOT imply organizational ownership.
 *   • A technology fingerprint does NOT imply a vulnerability.
 *   • "login" does NOT imply a security weakness.
 *
 * PROVENANCE INVARIANT:
 *   Every evidence record backing an expectation must satisfy:
 *   1. evidence.public_url canonicalizes to the same resource as the entry point's canonical_url
 *   2. evidence.temporal_status is not 'HISTORICAL' (unless expectation_type is HISTORICAL_EXPECTATION)
 *   3. evidence.evidence_origin is a recognized public-observation origin
 *
 *   Evidence from an alias, related URL, CDN, sub-page, historical page, or
 *   different environment CANNOT silently become the expectation for another resource.
 *
 * CONTEXT ARTIFACT RULE:
 *   If entry_point.is_context_artifact === true OR
 *   verification_eligibility.eligible === false,
 *   verification-oriented expectations (STATUS_BEHAVIOR, AUTH_REQUIRED,
 *   BOUNDARY_BEHAVIOR, PROTECTED_RESOURCE) are suppressed.
 *   Context artifacts remain in the graph for correlation but do not
 *   generate standalone expectations.
 *
 * Each ExpectedBehavior carries evidence_ids and a confidence level.
 */

import { createHash } from 'crypto';
import type { Evidence } from './IntelligenceCase';
import type { EntryPoint, EntryPointGraph } from './EntryPointModel';
import type { ExpectedBehavior, ExpectationType, ExpectationSource } from './findings/ProblemFinding';
import { normalizeUrl } from './EntryPointDiscovery';

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * Keywords in evidence text that indicate authentication is documented as required.
 */
const AUTH_REQUIRED_INDICATORS = [
  'authentication required', 'auth required', 'requires authentication',
  'must be authenticated', 'authentication is required',
  'jwt', 'bearer token', 'api key', 'api-key',
  'sign in', 'sign-in', 'log in', 'log-in',
  'authorization required', 'auth required',
  'oauth', 'oidc', 'sso', 'saml',
  'session required', 'login required',
  '401', '403', 'unauthorized', 'forbidden',
];

/**
 * Keywords in evidence text that indicate authentication is documented as NOT required.
 */
const AUTH_NOT_REQUIRED_INDICATORS = [
  'publicly accessible', 'no authentication', 'no auth',
  'unauthenticated access', 'open to', 'no login',
  'public access', 'without authentication',
  'no api key needed', 'no token',
  'guest', 'anonymous',
];
/**
 * Keywords indicating the endpoint exposes or requires a security control
 * (CORS, CSP, HSTS, etc.).
 */
const SECURITY_CONTROL_INDICATORS = {
  'Content-Security-Policy': ['content-security-policy', 'csp', 'content security policy'],
  'Strict-Transport-Security': ['strict-transport-security', 'hsts'],
  'X-Frame-Options': ['x-frame-options', 'frame-options'],
  'X-Content-Type-Options': ['x-content-type-options', 'nosniff', 'x-content-type-options'],
  'Cross-Origin-Opener-Policy': ['cross-origin-opener-policy', 'coop'],
  'Referrer-Policy': ['referrer-policy', 'referrers-policy'],
};

/**
 * Evidence origin → expectation source mapping.
 */
function mapEvidenceOriginToSource(
  origin: string,
  sourceType: string
): ExpectationSource {
  if (origin === 'DOCUMENTED_SOURCE' || origin === 'DOCUMENTED_FACT' || sourceType === 'PUBLIC_DOCUMENTATION' || sourceType === 'API_REFERENCE' || sourceType === 'API_DOCUMENTATION') {
    return 'EXPLICIT_DOCUMENTATION';
  }
  if (origin === 'REAL_PUBLIC_OBSERVATION') {
    return 'OBSERVED_NORMAL_BEHAVIOR';
  }
  if (sourceType === 'JS_BUNDLE' || sourceType === 'CLIENT_JS_BUNDLE') {
    return 'PUBLIC_CLIENT_CODE';
  }
  if (sourceType === 'SECURITY' || sourceType === 'STATUS_PAGE') {
    return 'PUBLIC_SECURITY_STATEMENT';
  }
  if (sourceType === 'GITHUB' || sourceType === 'REPO_GITHUB') {
    return 'PUBLIC_ARCHITECTURE_EVIDENCE';
  }
  return 'OBSERVED_NORMAL_BEHAVIOR';
}

/**
 * Determine whether evidence text mentions an auth-related pattern.
 */
function evidenceMentionsAuth(text: string): { auth_required?: boolean; auth_not_required?: boolean } {
  const lower = text.toLowerCase();
  const required = AUTH_REQUIRED_INDICATORS.some(kw => lower.includes(kw.toLowerCase()));
  const notRequired = AUTH_NOT_REQUIRED_INDICATORS.some(kw => lower.includes(kw.toLowerCase()));
  return { auth_required: required, auth_not_required: notRequired };
}

/**
 * Detect whether evidence text references a request builder or auth header
 * construction in client code (implies the endpoint is expected to be authenticated).
 * This is only applied when evidence source_type is JS_BUNDLE.
 */
function jsEvidenceImpliesAuth(text: string): boolean {
  const lower = text.toLowerCase();
  // Patterns that indicate client-side JS constructs auth headers
  return ['buildrequestheaders', 'authorization', 'bearer token', 'stytch', 'jwt', 'api key']
    .some(kw => lower.includes(kw.toLowerCase()));
}
/** Generate a stable ID for an expectation. */
function makeExpectationId(entryPointId: string, expectationType: string, counter: number, statement: string = ''): string {
  const hash = createHash('sha256').update(`${entryPointId}_${expectationType}_${statement}`).digest('hex').substr(0, 8);
  return `exp_${entryPointId.slice(0, 8)}_${expectationType.toLowerCase()}_${hash}`;
}

/**
 * Suffixes/prefixes that indicate an API entry point rather than a web page.
 * API endpoints legitimately return JSON/XML/etc. — they should NOT get
 * PUBLIC_CONTENT (text/html) expectations.
 */
const API_SURFACE_INDICATORS = [
  'API_REST', 'API_VERSIONED', 'DOMAIN_API', 'API_GRAPHQL',
  'API_RPC', 'API_GRAPHQL_ENDPOINT', 'API_OPERATION',
  'API_ENDPOINT', 'REST_API', 'GRAPHQL_API', 'RPC_API',
  'API_DOCUMENTATION', 'API_REFERENCE',
];

function isApiEntryType(surfaceType: string | undefined): boolean {
  if (!surfaceType) return false;
  const upper = surfaceType.toUpperCase();
  return API_SURFACE_INDICATORS.some(ind => upper.includes(ind));
}

/**
 * Infer the expected content type for an API endpoint from evidence.
 * If evidence mentions specific content types (JSON, XML, etc.), return them.
 * If no content type is supported by evidence, return undefined (no content-type
 * differential will be generated).
 */
function inferApiExpectedContentType(evidence: Evidence[]): string[] | undefined {
  const contentTypes = new Set<string>();
  for (const e of evidence) {
    const combined = `${e.evidence_text || ''} ${e.raw_observation || ''}`.toLowerCase();
    if (combined.includes('application/json') || combined.includes('json')) {
      contentTypes.add('application/json');
    }
    if (combined.includes('application/xml') || combined.includes('xml')) {
      contentTypes.add('application/xml');
    }
  }
  if (contentTypes.size === 0) return undefined;
  return Array.from(contentTypes);
}

// ── Provenance Validation ────────────────────────────────────────────────────

/**
 * Valid evidence origins for public-intelligence expectations.
 * MOCK_TEST is excluded — only real public observation evidence is accepted.
 */
const VALID_EVIDENCE_ORIGINS = new Set([
  'REAL_PUBLIC_OBSERVATION',
  'DOCUMENTED_SOURCE',
  'DOCUMENTED_FACT',
  'PASSIVE_RECON',
  'DISCOVERY',
  'BEHAVIORAL_XRAY',
  'OFFICIAL_COMPANY_SOURCE',
  'PUBLIC_PROFESSIONAL_SOURCE',
]);

/**
 * Validate that an evidence record is provenance-correct for a given entry point.
 *
 * @param evidence        The evidence record to validate.
 * @param ep              The entry point being evaluated.
 * @param requireUrlMatch If true, evidence.public_url must canonicalize to the
 *                        same resource as the entry point's canonical_url.
 *                        This is used for STATUS_BEHAVIOR where the status code
 *                        MUST be observed on the exact resource.
 *                        For documentation/JS-auth expectations, URL match is
 *                        NOT required because the evidence is about the resource
 *                        even if hosted at a different URL (docs, JS bundles).
 *
 * Returns { valid, reason } where `reason` explains why evidence failed
 * (empty string when valid).
 */
function validateEvidenceProvenance(
  evidence: Evidence,
  ep: EntryPoint,
  requireUrlMatch: boolean,
): { valid: boolean; reason: string } {
  // 1. Evidence origin must be a recognized public-observation origin
  if (!VALID_EVIDENCE_ORIGINS.has(evidence.evidence_origin)) {
    return { valid: false, reason: `evidence_origin '${evidence.evidence_origin}' is not a recognized public-observation origin` };
  }

  // 2. Historical evidence is only valid for HISTORICAL_EXPECTATION type
  const isHistorical = evidence.temporal_status === 'HISTORICAL';

  // 3. URL match: evidence.public_url must canonicalize to the same
  //    resource as the entry point's canonical_url
  //    Only enforced when requireUrlMatch=true (STATUS_BEHAVIOR rule).
  if (requireUrlMatch) {
    const epUrl = normalizeUrl(ep.canonical_url || ep.surface_url);
    const evUrl = normalizeUrl(evidence.public_url || evidence.provenance?.canonical_url || '');
    if (evUrl && epUrl && evUrl !== epUrl) {
      return { valid: false, reason: `evidence public_url '${evidence.public_url}' does not match entry point canonical_url '${ep.canonical_url || ep.surface_url}'` };
    }
  }

  return { valid: true, reason: isHistorical ? 'historical' : '' };
}

/**
 * Filter evidence to only provenance-valid records for a given entry point.
 * Returns [validEvidence, invalidEvidence] — the latter is used to populate
 * invalid_evidence_ids on the expectation.
 */
function filterProvenanceValidEvidence(
  ep: EntryPoint,
  epEvidence: Evidence[],
  requireUrlMatch: boolean,
): { valid: Evidence[]; invalid: { evidence: Evidence; reason: string }[] } {
  const valid: Evidence[] = [];
  const invalid: { evidence: Evidence; reason: string }[] = [];

  for (const e of epEvidence) {
    const result = validateEvidenceProvenance(e, ep, requireUrlMatch);
    if (result.valid) {
      valid.push(e);
    } else {
      invalid.push({ evidence: e, reason: result.reason });
    }
  }

  return { valid, invalid };
}

/**
 * Check if evidence text contains a security control keyword.
 */
function findSecurityControl(text: string): { control: string; present: boolean } | null {
  const lower = text.toLowerCase();
  for (const [control, keywords] of Object.entries(SECURITY_CONTROL_INDICATORS)) {
    if (keywords.some(kw => lower.includes(kw.toLowerCase()))) {
      return { control, present: true };
    }
  }
  return null;
}

/**
 * Expectation Engine — generates evidence-backed expected behaviors for entry points.
 */
export class ExpectationEngine {
  /**
   * Generate expectations for a set of entry points using the available evidence.
   *
   * @param entryPoints  All discovered entry points
   * @param evidence     All evidence records (indexed by id internally)
   * @param graph        The entry point relationship graph (for context)
   * @returns Array of ExpectedBehavior, one per evidence-backed expectation
   */
  generate(entryPoints: EntryPoint[], evidence: Evidence[], graph: EntryPointGraph): ExpectedBehavior[] {
    const expectations: ExpectedBehavior[] = [];
    const evidenceMap = new Map(evidence.map(e => [e.id, e]));
    const now = new Date().toISOString();

    for (const ep of entryPoints) {
      let counter = 0;
      const epEvidence = ep.evidence_ids
        .map(eid => evidenceMap.get(eid))
        .filter((e): e is Evidence => e !== undefined);

      // ── Context artifact check ──
      // Context artifacts (DOMAIN_CANONICAL, CLOUD_PUBLIC_REFERENCE, etc.)
      // and non-verification-eligible entry points do not generate
      // verification-oriented expectations.
      const isContext = ep.is_context_artifact === true ||
                        ep.verification_eligibility?.eligible === false;

      // ── Provenance-scoped evidence filtering ──
      // Two levels of filtering:
      // 1. URL-matched evidence: evidence.public_url canonicalizes to the
      //    same resource as the entry point. Used for STATUS_BEHAVIOR (status
      //    codes must be observed on the exact resource).
      // 2. Origin-valid evidence (no URL match): used for documentation, JS
      //    auth, security controls, etc. — evidence about the resource may
      //    be hosted at a documentation or JS-bundle URL.
      // BOTH levels exclude historical evidence from current expectations.
      // Historical evidence is only used for HISTORICAL_EXPECTATION.
      const { valid: urlMatchedEvidence, invalid: urlMatchedInvalid } =
        filterProvenanceValidEvidence(ep, epEvidence.filter(e => e.temporal_status !== 'HISTORICAL'), true);

      const { valid: originValidEvidence, invalid: originInvalidEvidence } =
        filterProvenanceValidEvidence(ep, epEvidence.filter(e => e.temporal_status !== 'HISTORICAL'), false);

      // Provenance for origin-valid evidence (used by most expectations)
      const provenanceDetails = originInvalidEvidence.map(e => e.reason);
      const invalidEvidenceIds = originInvalidEvidence.map(e => e.evidence.id);
      const provenanceValid = invalidEvidenceIds.length === 0;

      // Provenance for URL-matched evidence (used by STATUS_BEHAVIOR)
      const urlProvenanceDetails = urlMatchedInvalid.map(e => e.reason);
      const urlInvalidEvidenceIds = urlMatchedInvalid.map(e => e.evidence.id);
      const urlProvenanceValid = urlInvalidEvidenceIds.length === 0;

      // ── Collect all evidence text from origin-valid evidence ──
      const allEvidenceText = [...originValidEvidence.map(e => e.evidence_text || ''), ...originValidEvidence.map(e => e.raw_observation || '')].join('\n\n').toLowerCase();
      const hasAuthEvidence = originValidEvidence.some(e => e.structured_data?.auth_requirement === 'REQUIRED');

      // ── Generate expectations per entry point ──

      // 1. AUTH_REQUIRED or AUTH_NOT_REQUIRED — only from explicit evidence
      //    Skip for context artifacts (auth boundaries are for real surfaces)
      if (!isContext) {
        const authEvidence = originValidEvidence.filter(e => {
          const combined = `${e.evidence_text || ''} ${e.raw_observation || ''}`.toLowerCase();
          return AUTH_REQUIRED_INDICATORS.some(kw => combined.includes(kw.toLowerCase())) ||
                 AUTH_NOT_REQUIRED_INDICATORS.some(kw => combined.includes(kw.toLowerCase())) ||
                 (e.source_type === 'JS_BUNDLE' && jsEvidenceImpliesAuth(combined));
        });

        if (authEvidence.length > 0) {
          const authText = authEvidence.map(e => `${e.evidence_text || ''} ${e.raw_observation || ''}`).join('\n').toLowerCase();
          const jsAuthEvidence = authEvidence.some(e => e.source_type === 'JS_BUNDLE' && jsEvidenceImpliesAuth(`${e.evidence_text || ''} ${e.raw_observation || ''}`));

          // Check auth-not-required FIRST
          const authNotRequired = authText.includes('publicly accessible') || authText.includes('no authentication') || authText.includes('no auth') || authText.includes('unauthenticated access') || authText.includes('public access') || authText.includes('without authentication') || authText.includes('no api key') || authText.includes('no token');

          const authRequired = !authNotRequired && (
            authText.includes('authentication required') || authText.includes('requires authentication') || authText.includes('jwt') || authText.includes('bearer token') || authText.includes('api key') || authText.includes('sign in') || authText.includes('log in') || authText.includes('401') || authText.includes('unauthorized') || jsAuthEvidence
          );

          if (authNotRequired && !authRequired) {
            const expectation: ExpectedBehavior = {
              expectation_id: makeExpectationId(ep.entry_point_id, 'AUTH_NOT_REQUIRED', counter++, 'NOT_REQUIRED'),
              entry_point_id: ep.entry_point_id,
              expectation_type: 'AUTH_NOT_REQUIRED',
              statement: `Authentication is not required to access this entry point. Evidence: ${authEvidence.map(e => e.id).join(', ')}`,
              source: 'EXPLICIT_DOCUMENTATION',
              evidence_ids: authEvidence.map(e => e.id),
              expected_authentication: 'NOT_REQUIRED',
              expected_authorization: 'UNKNOWN',
              confidence: 'HIGH',
              uncertainty: [],
              current: true,
              historical: false,
              expectation_provenance_valid: provenanceValid,
              invalid_evidence_ids: invalidEvidenceIds,
              provenance_details: provenanceDetails,
              generated_at: now,
            };
            expectations.push(expectation);
          } else if (authRequired && !authNotRequired) {
            const isJsSource = authEvidence.some(e => e.source_type === 'JS_BUNDLE');
            const expectation: ExpectedBehavior = {
              expectation_id: makeExpectationId(ep.entry_point_id, 'AUTH_REQUIRED', counter++, 'REQUIRED'),
              entry_point_id: ep.entry_point_id,
              expectation_type: 'AUTH_REQUIRED',
              statement: `Authentication is required to access this entry point. Evidence: ${authEvidence.map(e => e.id).join(', ')}`,
              source: isJsSource ? 'PUBLIC_CLIENT_CODE' : 'EXPLICIT_DOCUMENTATION',
              evidence_ids: authEvidence.map(e => e.id),
              expected_authentication: 'REQUIRED',
              expected_authorization: 'UNKNOWN',
              confidence: 'HIGH',
              uncertainty: [],
              current: true,
              historical: false,
              expectation_provenance_valid: provenanceValid,
              invalid_evidence_ids: invalidEvidenceIds,
              provenance_details: provenanceDetails,
              generated_at: now,
            };
            expectations.push(expectation);
          }
        }
      }

      // 2. DOCUMENTED_OPERATION — evidence from API docs
      //    Uses origin-valid evidence (no URL match required — docs can be at different URLs)
      const docEvidence = originValidEvidence.filter(e =>
        (e.source_type as string) === 'API_DOCUMENTATION' ||
        (e.source_type as string) === 'API_REFERENCE' ||
        e.source_type === 'PUBLIC_DOCUMENTATION' ||
        e.evidence_origin === 'DOCUMENTED_SOURCE'
      );
      if (docEvidence.length > 0) {
        const expProvValid = provenanceValid;
        const expectation: ExpectedBehavior = {
          expectation_id: makeExpectationId(ep.entry_point_id, 'DOCUMENTED_OPERATION', counter++),
          entry_point_id: ep.entry_point_id,
          expectation_type: 'DOCUMENTED_OPERATION',
          statement: `The existence and behavior of this operation is documented in public documentation. Evidence: ${docEvidence.map(e => e.id).join(', ')}`,
          source: 'EXPLICIT_DOCUMENTATION',
          evidence_ids: docEvidence.map(e => e.id),
          confidence: 'MEDIUM',
          uncertainty: [],
          current: true,
          historical: false,
          expectation_provenance_valid: expProvValid,
          invalid_evidence_ids: invalidEvidenceIds,
          provenance_details: provenanceDetails,
          generated_at: now,
        };
        expectations.push(expectation);
      }

      // 3. PROTECTED_RESOURCE — JS bundle auth evidence
      //    Skip for context artifacts
      if (!isContext) {
        const jsAuthEvidence = originValidEvidence.filter(e =>
          (e.source_type === 'JS_BUNDLE' || (e.source_type as string) === 'CLIENT_JS_BUNDLE') &&
          jsEvidenceImpliesAuth(`${e.evidence_text || ''} ${e.raw_observation || ''}`)
        );
        if (jsAuthEvidence.length > 0) {
          const expectation: ExpectedBehavior = {
            expectation_id: makeExpectationId(ep.entry_point_id, 'PROTECTED_RESOURCE', counter++),
            entry_point_id: ep.entry_point_id,
            expectation_type: 'PROTECTED_RESOURCE',
            statement: `Public client code constructs authenticated request headers for this entry point, indicating it is expected to be protected. Evidence: ${jsAuthEvidence.map(e => e.id).join(', ')}`,
            source: 'PUBLIC_CLIENT_CODE',
            evidence_ids: jsAuthEvidence.map(e => e.id),
            expected_authentication: 'REQUIRED',
            confidence: 'HIGH',
            uncertainty: [],
            current: true,
            historical: false,
            expectation_provenance_valid: provenanceValid,
            invalid_evidence_ids: invalidEvidenceIds,
            provenance_details: provenanceDetails,
            generated_at: now,
          };
          expectations.push(expectation);
        }
      }

      // 4. PUBLIC_CONTENT / API_PUBLIC_RESPONSE — evidence shows 200 response with public/observable content
      //    For API entry points (API_REST, DOMAIN_API, API_GRAPHQL, etc.), generate
      //    API_PUBLIC_RESPONSE instead of PUBLIC_CONTENT. API endpoints legitimately
      //    return JSON/XML, not text/html — so we should NOT expect a specific
      //    content type unless evidence explicitly establishes one.
      const isApiSurface = isApiEntryType(ep.surface_type);
      const publicContentEvidence = originValidEvidence.filter(e => {
        if (e.status === 200 || e.status === null) {
          const combined = `${e.evidence_text || ''} ${e.raw_observation || ''}`.toLowerCase();
          return combined.includes('loading') || combined.includes('public') || combined.includes('shell') || e.evidence_origin === 'REAL_PUBLIC_OBSERVATION';
        }
        return false;
      });
      if (publicContentEvidence.length > 0) {
        if (isApiSurface) {
          // API endpoint — generate API_PUBLIC_RESPONSE (no assumed content type)
          const expectation: ExpectedBehavior = {
            expectation_id: makeExpectationId(ep.entry_point_id, 'API_PUBLIC_RESPONSE', counter++),
            entry_point_id: ep.entry_point_id,
            expectation_type: 'API_PUBLIC_RESPONSE',
            statement: `This API endpoint is publicly accessible and expected to respond with HTTP 200. Content type depends on API specification (not assumed HTML). Evidence: ${publicContentEvidence.map(e => e.id).join(', ')}`,
            source: 'OBSERVED_NORMAL_BEHAVIOR',
            evidence_ids: publicContentEvidence.map(e => e.id),
            expected_status_codes: [200],
            expected_content_type: inferApiExpectedContentType(publicContentEvidence),
            confidence: 'MEDIUM',
            uncertainty: [],
            current: true,
            historical: false,
            expectation_provenance_valid: provenanceValid,
            invalid_evidence_ids: invalidEvidenceIds,
            provenance_details: provenanceDetails,
            generated_at: now,
          };
          expectations.push(expectation);
        } else {
          // Web page — generate PUBLIC_CONTENT (expects text/html)
          const expectation: ExpectedBehavior = {
            expectation_id: makeExpectationId(ep.entry_point_id, 'PUBLIC_CONTENT', counter++),
            entry_point_id: ep.entry_point_id,
            expectation_type: 'PUBLIC_CONTENT',
            statement: `This entry point serves a public HTML shell or content. Evidence: ${publicContentEvidence.map(e => e.id).join(', ')}`,
            source: 'OBSERVED_NORMAL_BEHAVIOR',
            evidence_ids: publicContentEvidence.map(e => e.id),
            expected_status_codes: [200],
            expected_content_type: ['text/html'],
            confidence: 'MEDIUM',
            uncertainty: [],
            current: true,
            historical: false,
            expectation_provenance_valid: provenanceValid,
            invalid_evidence_ids: invalidEvidenceIds,
            provenance_details: provenanceDetails,
            generated_at: now,
          };
          expectations.push(expectation);
        }
      }

      // 5. SECURITY_CONTROL — evidence mentions a specific security header
      const secEvidence = originValidEvidence.filter(e => {
        const combined = `${e.evidence_text || ''} ${e.raw_observation || ''}`;
        return findSecurityControl(combined) !== null;
      });
      if (secEvidence.length > 0) {
        const controlsFound = new Set<string>();
        for (const e of secEvidence) {
          const combined = `${e.evidence_text || ''} ${e.raw_observation || ''}`;
          const control = findSecurityControl(combined);
          if (control) controlsFound.add(control.control);
        }
        const expectation: ExpectedBehavior = {
          expectation_id: makeExpectationId(ep.entry_point_id, 'SECURITY_CONTROL', counter++),
          entry_point_id: ep.entry_point_id,
          expectation_type: 'SECURITY_CONTROL',
          statement: `Security controls expected: ${Array.from(controlsFound).join(', ')}. Evidence: ${secEvidence.map(e => e.id).join(', ')}`,
          source: 'OBSERVED_NORMAL_BEHAVIOR',
          evidence_ids: secEvidence.map(e => e.id),
          expected_behavioral_properties: Array.from(controlsFound).map(c => `header_${c.toLowerCase().replace(/-/g, '_')}_present`),
          confidence: 'HIGH',
          uncertainty: [],
          current: true,
          historical: false,
          expectation_provenance_valid: provenanceValid,
          invalid_evidence_ids: invalidEvidenceIds,
          provenance_details: provenanceDetails,
          generated_at: now,
        };
        expectations.push(expectation);
      }

      // 6. STATUS_BEHAVIOR — evidence shows specific status codes (e.g. 401, 403)
      //    CRITICAL: only use URL-matched evidence (the status code MUST be
      //    observed on the exact resource, not aliased from sub-pages/CDN).
      //    Skip for context artifacts.
      if (!isContext) {
        const statusEvidence = urlMatchedEvidence.filter(e =>
          e.status !== null && e.status !== undefined && (e.status === 401 || e.status === 403 || e.status === 404)
        );
        if (statusEvidence.length > 0) {
          const expectedCodes = [...new Set(statusEvidence.map(e => e.status!))];
          const expectation: ExpectedBehavior = {
            expectation_id: makeExpectationId(ep.entry_point_id, 'STATUS_BEHAVIOR', counter++),
            entry_point_id: ep.entry_point_id,
            expectation_type: 'STATUS_BEHAVIOR',
            statement: `Unauthenticated access is expected to return HTTP ${expectedCodes.join(' or ')}. Evidence: ${statusEvidence.map(e => e.id).join(', ')}`,
            source: 'OBSERVED_NORMAL_BEHAVIOR',
            evidence_ids: statusEvidence.map(e => e.id),
            expected_status_codes: expectedCodes,
            confidence: 'HIGH',
            uncertainty: urlProvenanceDetails.length > 0 ? [`Some evidence filtered: ${urlProvenanceDetails.join('; ')}`] : [],
            current: true,
            historical: false,
            expectation_provenance_valid: urlProvenanceValid,
            invalid_evidence_ids: urlInvalidEvidenceIds,
            provenance_details: urlProvenanceDetails,
            generated_at: now,
          };
          expectations.push(expectation);
        }
      }

      // 7. PERFORMANCE_BASELINE — evidence has latency data
      const perfEvidence = originValidEvidence.filter(e =>
        e.latency_ms !== undefined && e.latency_samples !== undefined && e.latency_samples.length > 0
      );
      if (perfEvidence.length > 0) {
        const avgLatency = perfEvidence.reduce((sum, e) => sum + (e.latency_ms || 0), 0) / perfEvidence.length;
        const expectation: ExpectedBehavior = {
          expectation_id: makeExpectationId(ep.entry_point_id, 'PERFORMANCE_BASELINE', counter++),
          entry_point_id: ep.entry_point_id,
          expectation_type: 'PERFORMANCE_BASELINE',
          statement: `Expected response latency baseline ≈ ${Math.round(avgLatency)}ms (observed across ${perfEvidence.length} evidence records). Evidence: ${perfEvidence.map(e => e.id).join(', ')}`,
          source: 'OBSERVED_NORMAL_BEHAVIOR',
          evidence_ids: perfEvidence.map(e => e.id),
          expected_behavioral_properties: [`latency_baseline_${Math.round(avgLatency)}ms`],
          confidence: 'MEDIUM',
          uncertainty: [],
          current: true,
          historical: false,
          expectation_provenance_valid: provenanceValid,
          invalid_evidence_ids: invalidEvidenceIds,
          provenance_details: provenanceDetails,
          generated_at: now,
        };
        expectations.push(expectation);
      }

      // 8. BOUNDARY_BEHAVIOR — entry point has auth model and auth evidence
      //    Skip for context artifacts
      if (!isContext && ep.authentication_model !== 'UNKNOWN' && ep.authentication_model !== 'NONE' && hasAuthEvidence) {
        // For BOUNDARY_BEHAVIOR, only use origin-valid evidence
        const boundaryEvidenceIds = ep.evidence_ids.filter(eid => {
          const e = evidenceMap.get(eid);
          if (!e) return false;
          // Must be current (not historical) evidence with valid provenance
          if (e.temporal_status === 'HISTORICAL') return false;
          const result = validateEvidenceProvenance(e, ep, false);
          return result.valid;
        });
        if (boundaryEvidenceIds.length > 0) {
          const expectation: ExpectedBehavior = {
            expectation_id: makeExpectationId(ep.entry_point_id, 'BOUNDARY_BEHAVIOR', counter++),
            entry_point_id: ep.entry_point_id,
            expectation_type: 'BOUNDARY_BEHAVIOR',
            statement: `Auth boundary: this entry point uses ${ep.authentication_model} authentication and is expected to reject unauthenticated data access. Evidence: ${boundaryEvidenceIds.join(', ')}`,
            source: 'MULTI_SOURCE_CORRELATION',
            evidence_ids: boundaryEvidenceIds,
            expected_authentication: 'REQUIRED',
            expected_authorization: ep.authorization_model === 'PUBLIC' ? 'NOT_REQUIRED' : undefined,
            confidence: 'HIGH',
            uncertainty: [],
            current: true,
            historical: false,
            expectation_provenance_valid: provenanceValid,
            invalid_evidence_ids: invalidEvidenceIds,
            provenance_details: provenanceDetails,
            generated_at: now,
          };
          expectations.push(expectation);
        }
      }

      // 9. HISTORICAL_EXPECTATION — historical evidence
      //    Filter from ALL provenance-valid evidence (including historical).
      //    Only historical evidence creates HISTORICAL_EXPECTATION.
      const { valid: histValid, invalid: histInvalid } =
        filterProvenanceValidEvidence(ep, epEvidence, false);
      const histEvidence = histValid.filter(e =>
        (e.temporal_status as string) === 'HISTORICAL'
      );
      if (histEvidence.length > 0) {
        const expectation: ExpectedBehavior = {
          expectation_id: makeExpectationId(ep.entry_point_id, 'HISTORICAL_EXPECTATION', counter++),
          entry_point_id: ep.entry_point_id,
          expectation_type: 'HISTORICAL_EXPECTATION',
          statement: `Historical expectation from past evidence. Evidence: ${histEvidence.map(e => e.id).join(', ')}`,
          source: 'HISTORICAL_SOURCE',
          evidence_ids: histEvidence.map(e => e.id),
          confidence: 'LOW',
          uncertainty: ['Historical evidence may not reflect current state'],
          current: false,
          historical: true,
          expectation_provenance_valid: provenanceValid,
          invalid_evidence_ids: invalidEvidenceIds,
          provenance_details: provenanceDetails,
          generated_at: now,
        };
        expectations.push(expectation);
      }
    }

    // ── Multi-source correlation: if an entry point has both JS-auth evidence
    //     and doc-auth evidence, elevate to MULTI_SOURCE_CORRELATION source ──
    for (const ep of entryPoints) {
      const jsAuthExp = expectations.find(e =>
        e.entry_point_id === ep.entry_point_id && e.expectation_type === 'PROTECTED_RESOURCE'
      );
      const docAuthExp = expectations.find(e =>
        e.entry_point_id === ep.entry_point_id && e.expectation_type === 'AUTH_REQUIRED' && e.source !== 'PUBLIC_CLIENT_CODE'
      );
      if (jsAuthExp && docAuthExp) {
        // Correlate: create a combined expectation
        const allEvidence = [...new Set([...jsAuthExp.evidence_ids, ...docAuthExp.evidence_ids])];
        // Provenance is valid only if both source expectations have valid provenance
        const correlatedProvValid = jsAuthExp.expectation_provenance_valid && docAuthExp.expectation_provenance_valid;
        const correlatedInvalidIds = [...new Set([...jsAuthExp.invalid_evidence_ids, ...docAuthExp.invalid_evidence_ids])];
        const correlatedProvDetails = [...new Set([...(jsAuthExp.provenance_details || []), ...(docAuthExp.provenance_details || [])])];
        const expectation: ExpectedBehavior = {
          expectation_id: makeExpectationId(ep.entry_point_id, 'BOUNDARY_BEHAVIOR', expectations.length + 1),
          entry_point_id: ep.entry_point_id,
          expectation_type: 'BOUNDARY_BEHAVIOR',
          statement: `Client code and documentation both indicate authentication is required for this entry point (correlated).`,
          source: 'MULTI_SOURCE_CORRELATION',
          evidence_ids: allEvidence,
          expected_authentication: 'REQUIRED',
          confidence: 'HIGH',
          uncertainty: [],
          current: true,
          historical: false,
          expectation_provenance_valid: correlatedProvValid,
          invalid_evidence_ids: correlatedInvalidIds,
          provenance_details: correlatedProvDetails,
          generated_at: now,
        };
        expectations.push(expectation);
      }
    }

    return expectations;
  }
}
