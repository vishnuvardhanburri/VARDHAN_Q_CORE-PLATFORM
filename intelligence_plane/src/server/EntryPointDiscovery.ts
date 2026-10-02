/**
 * VARDHAN — ENTRY POINT DISCOVERY
 * ─────────────────────────────────────────────────────────────────────────────
 * Discovers and classifies all externally-reachable technical entry points
 * from the Evidence[] array and CompanySurface produced by the DeepProspectBuilder.
 *
 * Discovery is EVIDENCE-BACKED, not guessed. Every entry point must trace to
 * at least one evidence ID or documented reference. Hostnames are never
 * treated as organizational assets without evidence. Cloud-provider hostnames
 * are never treated as proof of ownership.
 *
 * The engine processes evidence in 8 phases:
 *   1. Canonical domain + evidenced subdomains
 *   2. Web surfaces (homepage, login, signup, dashboards, etc.)
 *   3. API surfaces (REST, GraphQL, RPC, webhooks, etc.)
 *   4. Identity surfaces (OAuth, OIDC, SSO, SAML, password reset)
 *   5. Client-side surfaces (JS bundles, configs, API URLs in JS)
 *   6. Security / operational surfaces (status, incident, security.txt)
 *   7. Cloud + repository + data + integration surfaces
 *   8. Legacy surfaces
 *
 * Each phase is a classifier that returns EntryPoint[] from matching evidence.
 */

import type { Evidence, CompanySurface, DiscoveredPage } from './IntelligenceCase';
import type { DeepSignal, EvidenceProvenance } from './DeepTypes';
import type {
  EntryPoint, EntryPointTelemetry, EntryPointGraph,
  EntryPointAttribution, EntryPointObservability,
  VerificationEligibility, EntryPointSurfaceType, EntryPointFunctionalRole,
  EntryPointProtocol, EntryPointAuthModel, EntryPointAuthzModel,
  EntryPointTenantBoundary, EntryPointEnvironment, EntryPointTechContext,
  EntryPointDiscoverySource, EntryPointStatus, IneligibilityReason,
} from './EntryPointModel';
import { createHash } from 'crypto';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Deterministic ID from organization + domain + normalized URL + surface type. */
function entryPointId(orgId: string, domain: string, url: string, surfaceType: string): string {
  const raw = `${orgId}|${domain}|${url}|${surfaceType}`;
  return 'ep_' + createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

/** Normalize a URL: lowercase host, strip fragments, strip tracking params. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    // Strip common tracking parameters
    const params = new URLSearchParams(u.search);
    const trackingKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', '_gl', '_ga', 'fbclid', 'gclid'];
    for (const k of trackingKeys) {
      params.delete(k);
    }
    u.search = params.toString();
    return u.toString();
  } catch {
    return url;
  }
}

/** Extract hostname from URL, handling missing protocols. */
function getHostname(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch {
    return url.replace(/\/.*$/, '');
  }
}

/** Extract registrable root domain from hostname. */
function extractRootDomain(hostname: string): string {
  let h = hostname.replace(/^www\./, '');
  const parts = h.split('.');
  if (parts.length >= 3) {
    h = parts.slice(-2).join('.');
  }
  return h;
}

/** Check if hostname is on the same root domain. */
function isSameRootDomain(hostname: string, rootDomain: string): boolean {
  return hostname === rootDomain || hostname.endsWith('.' + rootDomain);
}

/** Determine if a URL path looks like an API endpoint. */
function isApiPath(path: string): boolean {
  const p = path.toLowerCase();
  return p.startsWith('/api') || p.startsWith('/v1/') || p.startsWith('/v2/')
    || p.startsWith('/graphql') || p.includes('/rpc')
    || p.includes('/webhook') || p.includes('/callback');
}

/** Detect technology fingerprint from response body or headers. */
function detectTechContext(html: string, status: number, evidence: Evidence): EntryPointTechContext {
  if (!html) return 'UNKNOWN';
  const lower = html.toLowerCase();

  // Framework fingerprints
  if (lower.includes('__next_f') || lower.includes('next/script')) return 'NEXTJS';
  if (lower.includes('window.next')) return 'NEXTJS';
  if (lower.includes('react-root') || lower.includes('data-reactroot')) return 'REACT';
  if (lower.includes('ng-')) return 'ANGULAR';
  if (lower.includes('vue:') || lower.includes('__vue')) return 'VUE';
  if (lower.includes('_svelte')) return 'SVELTEKIT';

  // Auth provider fingerprints
  if (lower.includes('cdn.jsdelivr.net/npm/@supabase')) return 'SUPABASE';
  if (lower.includes('cdn.split.io') || lower.includes('optimizely')) return 'CUSTOM';
  if (lower.includes('cognito')) return 'COGNITO';
  if (lower.includes('auth0')) return 'AUTH0';
  if (lower.includes('firebase') || lower.includes('__firebase')) return 'FIREBASE';
  if (lower.includes('okta')) return 'OKTA';
  if (lower.includes('salesforce')) return 'SALESFORCE';
  if (lower.includes('stripe')) return 'STRIPE';

  // Cloud/platform fingerprints
  if (lower.includes('vercel')) return 'VERCEL';
  if (lower.includes('netlify')) return 'NETLIFY';
  if (lower.includes('cloudflare')) return 'CLOUDFLARE';
  if (lower.includes('sentry-cdn')) return 'SENTRY';
  if (lower.includes('datadog')) return 'DATADOG';

  // Server framework fingerprints from headers
  const serverHeader = (evidence as any).server_header as string | undefined;
  if (serverHeader) {
    const sh = serverHeader.toLowerCase();
    if (sh.includes('express')) return 'EXPRESS';
    if (sh.includes('fastify')) return 'FASTIFY';
    if (sh.includes('gunicorn')) return 'PYTHON_FLASK';
    if (sh.includes('uvicorn')) return 'PYTHON_FASTAPI';
    if (sh.includes('nginx')) return 'NGINX';
  }

  return 'UNKNOWN';
}

/** Determine authentication model from evidence behavior. */
function detectAuthModel(evidence: Evidence, url: string): EntryPointAuthModel {
  const obs = evidence.observed_behavior || '';
  const lower = (obs + ' ' + (evidence.raw_observation || '')).toLowerCase();

  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('authentication required'))
    return 'CUSTOM_TOKEN'; // observed requiring auth
  if (evidence.status === 401 || evidence.status === 403)
    return 'SESSION_COOKIE';
  if (url.includes('/oauth') || url.includes('/oauth2'))
    return 'OAUTH';
  if (url.includes('/sso') || url.includes('/saml'))
    return 'SAML';
  if (url.includes('/oidc'))
    return 'OIDC';
  if (evidence.tested_without_auth && evidence.status === 200)
    return 'NONE';

  return 'UNKNOWN';
}

/** Determine authorization model. */
function detectAuthzModel(evidence: Evidence, status: number): EntryPointAuthzModel {
  if (evidence.tested_without_auth && status === 200 && evidence.repeatable !== true)
    return 'PUBLIC';
  if (status === 401) return 'ROLE_BASED';
  if (status === 403) return 'POLICY_BASED';
  return 'UNKNOWN';
}

/** Determine protocol from URL scheme. */
function detectProtocol(url: string): EntryPointProtocol {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return 'HTTPS';
    if (u.protocol === 'http:') return 'HTTP';
    if (u.protocol === 'wss:') return 'WEBSOCKET';
    if (u.protocol === 'ws:') return 'WEBSOCKET';
  } catch {}
  if (url.includes('graphql')) return 'GRAPHQL';
  return 'HTTPS'; // default
}

/** Determine environment from URL or response. */
function detectEnvironment(url: string): EntryPointEnvironment {
  const lower = url.toLowerCase();
  if (lower.includes('staging') || lower.includes('stage') || lower.includes('stag'))
    return 'STAGING';
  if (lower.includes('dev') || lower.includes('test'))
    return 'DEVELOPMENT';
  if (lower.includes('canary'))
    return 'CANARY';
  return 'PRODUCTION'; // assume production for public surfaces
}

/** Surface types that are contextual artifacts, not physical externally-reachable surfaces. */
const CONTEXT_ARTIFACT_SURFACE_TYPES = new Set<EntryPointSurfaceType>([
  'CLIENT_JS_BUNDLE',
  'CLIENT_SOURCE_MAP',
  'CLIENT_FRONTEND_CONFIG',
  'CLIENT_PUBLIC_CONFIG',
  'CLIENT_DATA_ATTRIBUTE',
  'CLIENT_EMBEDDED_JSON',
  'CLIENT_SERVICE_WORKER',
  'CLIENT_BROWSER_REQUEST',
  'CLOUD_PUBLIC_REFERENCE',
  'CLOUD_STORAGE_REFERENCE',
  'CLOUD_CDN_REFERENCE',
  'CLOUD_DEPLOYMENT_REFERENCE',
  'CLOUD_INFRA_DOC',
  'REPO_GITHUB',
  'REPO_GITLAB',
  'REPO_PUBLIC_SDK',
  'REPO_EXAMPLE',
  'REPO_PACKAGE_DOC',
  'REPO_CI_CD_DOC',
  'REPO_IAC_REFERENCE',
  'REPO_ISSUE_DISCUSSION',
  'REPO_CONFIG_EXAMPLE',
  'REPO_INTEGRATION_DOC',
]);

/** Statuses that are never verification-eligible in PUBLIC mode. */
const INELIGIBLE_STATUSES = new Set<EntryPointStatus>([
  'LEGACY',
  'HISTORICAL',
  'ATTRIBUTED',
  'AUTHORIZATION_REQUIRED',
  'AUTHENTICATION_REQUIRED',
  'DOCUMENTED_ONLY',
  'DISCOVERED',
  'UNCONFIRMED',
  'REJECTED',
]);

/** Human-readable description for each ineligibility reason code. */
function reasonCodeToDescription(reason: IneligibilityReason): string {
  switch (reason) {
    case 'LEGACY_SURFACE': return 'Surface is legacy/historical — not currently relevant for verification.';
    case 'ATTRIBUTED_ONLY_NOT_OBSERVED': return 'Attributed but not publicly observable — cannot verify behavior.';
    case 'AUTHORIZATION_REQUIRED': return 'Authorization required — cannot verify in PUBLIC mode without crossing auth boundary.';
    case 'AUTHENTICATION_REQUIRED': return 'Authentication required — cannot verify in PUBLIC mode.';
    case 'DOCUMENTED_ONLY': return 'Documented only — not a runtime-observable surface.';
    case 'CLIENT_JS_BUNDLE': return 'Framework JS bundle — not an executable technical surface.';
    case 'CLOUD_PUBLIC_REFERENCE': return 'Third-party cloud/CDN reference — not org-owned infrastructure.';
    case 'NOT_EXTERNALLY_OBSERVABLE': return 'Not externally observable — insufficient evidence of public reachability.';
    case 'NOT_ATTRIBUTABLE': return 'Not attributable to the organization — insufficient evidence.';
    case 'CONTEXT_ARTIFACT': return 'Contextual artifact (repository reference, package text, etc.) — not a distinct externally-reachable surface.';
  }
}

/** Extract a clean URL path for classification. */
function getUrlPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.replace(/^https?:\/\/[^/]+/, '');
  }
}

/** Extract hostname without port. */
function getCleanHostname(url: string): string {
  return getHostname(url);
}

// ── Classification Functions ─────────────────────────────────────────────────

/** Classify a URL into surface type + functional role based on path and hostname. */
function classifyWebSurface(url: string, evidence: Evidence): EntryPointSurfaceType {
  const path = getUrlPath(url).toLowerCase();
  const host = getCleanHostname(url).toLowerCase();

  // Login pages
  if (path.startsWith('/login') || path.startsWith('/signin') || path.startsWith('/auth')
    || path.startsWith('/oauth') || path.startsWith('/sso') || path.includes('login'))
    return 'WEBSITE_LOGIN';

  // Signup / registration
  if (path.startsWith('/signup') || path.startsWith('/register') || path.startsWith('/join')
    || path.startsWith('/onboarding') || path.includes('/sign-up'))
    return 'WEBSITE_SIGNUP';

  // Password recovery
  if (path.startsWith('/password') || path.startsWith('/reset') || path.startsWith('/forgot')
    || path.includes('password-reset') || path.includes('recover'))
    return 'WEBSITE_PASSWORD_RECOVERY';

  // Account / dashboard portals
  if (path.startsWith('/account') || path.startsWith('/dashboard') || path.startsWith('/portal')
    || path.startsWith('/my-account'))
    return 'WEBSITE_ACCOUNT_PORTAL';

  // Admin interfaces
  if (path.startsWith('/admin') || path.startsWith('/console') || path.startsWith('/manage'))
    return 'WEBSITE_ADMIN_INTERFACE';

  // Developer / API docs
  if (path.startsWith('/docs') || path.startsWith('/developer') || path.startsWith('/api-docs')
    || path.startsWith('/reference') || path.startsWith('/developers'))
    return 'WEBSITE_DEVELOPER_PORTAL';

  // Status / security
  if (path.startsWith('/status') || path.startsWith('/incidents'))
    return 'SECURITY_STATUS_PAGE';
  if (path.startsWith('/security') || path.includes('security.txt') || path.startsWith('/.well-known'))
    return 'SECURITY_TXT';
  if (path.startsWith('/trust') || path.startsWith('/trust-center'))
    return 'SECURITY_TRUST_PAGE';

  // Playground / demo
  if (path.includes('/playground') || path.includes('/demo') || path.includes('/try'))
    return 'WEBSITE_PLAYGROUND';

  // API path → API surface
  if (isApiPath(path)) {
    if (evidence.source_type === 'API_ENDPOINT') return 'API_REST';
    if (path.includes('graphql')) return 'API_GRAPHQL';
    return 'API_REST';
  }

  // If it's an API endpoint with JSON
  if (evidence.source_type === 'API_ENDPOINT') return 'API_REST';

  // Default: product page, app, or homepage
  if (host === 'app.' + extractRootDomain(host)) return 'WEBSITE_APPLICATION';
  if (path === '/' || path === '') return 'WEBSITE_HOMEPAGE';
  if (path.includes('/blog') || path.includes('/library') || path.includes('/resources'))
    return 'WEBSITE_PRODUCT_PAGE';
  if (path.includes('/product') || path.includes('/features'))
    return 'WEBSITE_PRODUCT_PAGE';

  return 'WEBSITE_APPLICATION';
}

/** Classify functional role from surface type. */
function classifyFunctionalRole(surface: EntryPointSurfaceType): EntryPointFunctionalRole {
  switch (surface) {
    case 'WEBSITE_LOGIN':
    case 'WEBSITE_SIGNUP':
    case 'WEBSITE_PASSWORD_RECOVERY':
    case 'IDENTITY_LOGIN_SYSTEM':
      return 'AUTHENTICATION';
    case 'WEBSITE_ACCOUNT_PORTAL':
      return 'DATA_ACCESS';
    case 'WEBSITE_ADMIN_INTERFACE':
      return 'ADMINISTRATION';
    case 'WEBSITE_DEVELOPER_PORTAL':
    case 'REPO_PACKAGE_DOC':
    case 'REPO_CI_CD_DOC':
      return 'DEVELOPER_ACCESS';
    case 'API_REST':
    case 'API_GRAPHQL':
    case 'API_RPC':
    case 'API_GATEWAY':
      return 'BUSINESS_LOGIC';
    case 'API_WEBHOOK_RECEIVER':
    case 'API_CALLBACK':
      return 'WEBHOOK_HANDLER';
    case 'IDENTITY_OAUTH':
    case 'IDENTITY_OIDC':
    case 'IDENTITY_SSO':
      return 'AUTHENTICATION';
    case 'INTEGRATION_PAYMENT':
    case 'INTEGRATION_CRM':
    case 'INTEGRATION_MESSAGING':
    case 'INTEGRATION_PARTNER_API':
      return 'THIRD_PARTY_INTEGRATION';
    case 'SECURITY_STATUS_PAGE':
      return 'STATUS_MONITORING';
    case 'API_STREAMING':
      return 'DATA_ACCESS';
    default:
      return 'PRESENTATION';
  }
}

/** Determine entry-point status from observability. */
function classifyStatus(
  evidence: Evidence,
  isObserved: boolean,
  status: EntryPointStatus,
  hasAuthRequired: boolean
): EntryPointStatus {
  if (!isObserved) return 'DOCUMENTED_ONLY';

  // If we actually fetched it and got 200 without auth
  if (evidence.status === 200 && evidence.tested_without_auth) {
    if (evidence.repeatable) return 'VERIFIED_BEHAVIOR';
    return 'PUBLICLY_OBSERVABLE';
  }

  // Auth required
  if (evidence.status === 401 || evidence.status === 403) {
    return hasAuthRequired ? 'AUTHORIZATION_REQUIRED' : 'AUTHENTICATION_REQUIRED';
  }

  return status;
}

// ── Main Discovery Engine ─────────────────────────────────────────────────────

export interface EntryPointDiscoveryOptions {
  /** Organization name / ID for attribution. */
  organizationId: string;
  /** Canonical domain (root). */
  canonicalDomain: string;
  /** Previously attributed subdomains (for cross-source confirmation). */
  priorSubdomains?: Set<string>;
  /** Whether adaptive investigation pivots should be included. */
  includeAdaptive?: boolean;
}

/**
 * Discover all entry points from evidence, surface, and signal data.
 */
export class EntryPointDiscovery {
  private readonly orgId: string;
  private readonly canonicalDomain: string;
  private readonly rootDomain: string;
  private readonly priorSubdomains: Set<string>;
  private readonly includeAdaptive: boolean;

  constructor(private options: EntryPointDiscoveryOptions) {
    this.orgId = options.organizationId;
    this.canonicalDomain = options.canonicalDomain;
    this.rootDomain = extractRootDomain(options.canonicalDomain);
    this.priorSubdomains = options.priorSubdomains ?? new Set();
    this.includeAdaptive = options.includeAdaptive ?? false;
  }

  /** Run full discovery and return the result set. */
  discover(
    evidence: Evidence[],
    surface: CompanySurface,
    signals: DeepSignal[]
  ): EntryPoint[] {
    const eps: EntryPoint[] = [];
    const seen = new Set<string>();

    const add = (ep: EntryPoint) => {
      const key = ep.entry_point_id;
      if (!seen.has(key)) {
        seen.add(key);
        eps.push(ep);
      }
    };

    // Phase 1: Canonical domain
    add(this.discoverCanonicalDomain(evidence, surface));

    // Phase 2: Subdomains from evidence
    for (const ep of this.discoverSubdomains(evidence, surface)) add(ep);

    // Phase 3: Web surfaces from evidence URLs
    const webEvidence = evidence.filter(e =>
      e.source_type === 'PUBLIC_DOCUMENTATION' && e.public_url
    );
    for (const ep of this.discoverWebSurfaces(webEvidence, surface)) add(ep);

    // Phase 4: API surfaces from evidence
    const apiEvidence = evidence.filter(e =>
      e.source_type === 'API_ENDPOINT' && e.public_url
    );
    for (const ep of this.discoverApiSurfaces(apiEvidence, surface)) add(ep);

    // Phase 5: Identity surfaces
    for (const ep of this.discoverIdentitySurfaces(evidence, surface)) add(ep);

    // Phase 6: Client-side surfaces (JS bundles, configs in HTML)
    for (const ep of this.discoverClientSideSurfaces(evidence)) add(ep);

    // Phase 7: Security / operational surfaces
    for (const ep of this.discoverSecuritySurfaces(evidence, surface)) add(ep);

    // Phase 8: Cloud / repository / data / integration surfaces
    for (const ep of this.discoverCloudSurfaces(evidence)) add(ep);
    for (const ep of this.discoverRepositorySurfaces(evidence)) add(ep);

    // Phase 9: Legacy surfaces (from evidence mentioning deprecated/migration)
    for (const ep of this.discoverLegacySurfaces(evidence)) add(ep);

    // Phase 10: Adaptive pivot surfaces (if enabled)
    if (this.includeAdaptive) {
      for (const ep of this.discoverAdaptiveSurfaces(evidence)) add(ep);
    }

    // Phase 11: Cross-source confirmation
    this.annotateCrossSource(eps, evidence);

    // Phase 12: Merge canonical URL collisions
    const merged = this.mergeCanonicalCollisions(eps);

    return merged;
  }

  /** Phase 1: Canonical domain entry point. */
  private discoverCanonicalDomain(
    evidence: Evidence[],
    surface: CompanySurface
  ): EntryPoint {
    const url = surface.homepage || surface.company_homepage || `https://${this.canonicalDomain}`;
    const evidenceIds = evidence
      .filter(e => getHostname(e.public_url) === this.canonicalDomain || getHostname(e.public_url) === `www.${this.canonicalDomain}`)
      .map(e => e.id);

    const primaryEvidence = evidenceIds.length > 0 ? evidence.find(e => e.id === evidenceIds[0]) : undefined;

    return this.buildEntryPoint(
      `https://${this.canonicalDomain}`,
      'DOMAIN_CANONICAL',
      'PRESENTATION',
      evidenceIds,
      primaryEvidence,
      ['PUBLIC_OBSERVATION'],
      evidenceIds.length > 0 ? 'HIGH' : 'MEDIUM',
      evidenceIds.length > 0 ? this.entryStatus(primaryEvidence!) : 'DISCOVERED',
      'Canonical registrable root domain of the organization.'
    );
  }

  /** Phase 2: Evidenced subdomains. */
  private discoverSubdomains(
    evidence: Evidence[],
    surface: CompanySurface
  ): EntryPoint[] {
    const result: EntryPoint[] = [];
    const seenHosts = new Set<string>();

    // From evidence URLs
    for (const e of evidence) {
      if (!e.public_url) continue;
      const host = getCleanHostname(e.public_url);
      if (isSameRootDomain(host, this.rootDomain) && host !== this.rootDomain && host !== `www.${this.rootDomain}`) {
        if (!seenHosts.has(host)) {
          seenHosts.add(host);
          const subEvidence = evidence.filter(ee => getCleanHostname(ee.public_url) === host);
          const surfaceType = this.classifySubdomain(host);
          const confidence = this.priorSubdomains.has(host) ? 'HIGH' : 'MEDIUM';
          result.push(this.buildEntryPoint(
            `https://${host}`,
            surfaceType,
            'PRESENTATION',
            subEvidence.map(e => e.id),
            subEvidence[0],
            ['PUBLIC_OBSERVATION'],
            confidence,
            'ATTRIBUTED',
            `Subdomain discovered via public observation (same root domain: ${this.rootDomain}).`
          ));
        }
      }
    }

    return result;
  }

  /** Classify a subdomain by its hostname prefix. */
  private classifySubdomain(host: string): EntryPointSurfaceType {
    const prefix = host.split('.')[0]?.toLowerCase() || '';
    switch (prefix) {
      case 'api': return 'DOMAIN_API';
      case 'docs':
      case 'documentation':
      case 'developer':
      case 'developers': return 'DOMAIN_DOCUMENTATION';
      case 'status': return 'DOMAIN_STATUS';
      case 'login':
      case 'auth':
      case 'signin': return 'DOMAIN_LOGIN';
      case 'app':
      case 'portal': return 'DOMAIN_PRODUCT';  // product domain
      case 'support': return 'DOMAIN_SUPPORT';
      case 'trust': return 'DOMAIN_SUPPORT';
      case 'cdn': return 'DOMAIN_CDN';
      case 'assets': return 'DOMAIN_CDN';
      case 'sso': return 'DOMAIN_LOGIN';
      default: return 'DOMAIN_SUBDOMAIN';
    }
  }

  /** Phase 3: Web surfaces from evidence. */
  private discoverWebSurfaces(
    evidence: Evidence[],
    surface: CompanySurface
  ): EntryPoint[] {
    const result: EntryPoint[] = [];
    for (const e of evidence) {
      if (!e.public_url) continue;
      const path = getUrlPath(e.public_url).toLowerCase();
      const host = getCleanHostname(e.public_url);
      if (!isSameRootDomain(host, this.rootDomain)) continue;

      // Skip URLs that will be classified by dedicated phases (API, identity, security)
      if (isApiPath(path) || path.includes('/oauth') || path.includes('/oidc')
        || path.includes('/sso') || path.includes('/saml')
        || path.includes('/password') || path.includes('/reset') || path.includes('/forgot')
        || path.includes('/.well-known')) {
        continue;
      }

      const surfaceType = classifyWebSurface(e.public_url, e);
      if (isSameRootDomain(host, this.rootDomain)) {
        result.push(this.buildEntryPoint(
          e.public_url,
          surfaceType,
          classifyFunctionalRole(surfaceType),
          [e.id],
          e,
          ['PUBLIC_OBSERVATION'],
          this.entryConfidence(e),
          this.entryStatus(e),
          'Public web surface observed via HTTP GET.'
        ));
      }
    }
    return result;
  }

  /** Phase 4: API surfaces. */
  private discoverApiSurfaces(
    evidence: Evidence[],
    surface: CompanySurface
  ): EntryPoint[] {
    const result: EntryPoint[] = [];

    // From evidence URLs that look like API paths
    for (const e of evidence) {
      if (!e.public_url) continue;
      const path = getUrlPath(e.public_url).toLowerCase();
      const host = getCleanHostname(e.public_url);
      if (!isSameRootDomain(host, this.rootDomain)) continue;

      if (e.source_type === 'API_ENDPOINT' || isApiPath(path)) {
        let surfaceType: EntryPointSurfaceType = 'API_REST';
        // Safe check for GraphQL without throwing on non-JSON text
        let isGraphql = path.includes('graphql');
        if (e.source_type === 'API_ENDPOINT' && e.evidence_text) {
          try { if (JSON.parse(e.evidence_text).query) isGraphql = true; } catch {}
        }
        if (isGraphql) {
          surfaceType = 'API_GRAPHQL';
        }
        if (path.includes('webhook') || path.includes('callback')) {
          surfaceType = 'API_WEBHOOK_RECEIVER';
        }
        if (path.match(/\/v\d+/)) {
          surfaceType = 'API_VERSIONED';
        }

        result.push(this.buildEntryPoint(
          e.public_url,
          surfaceType,
          'BUSINESS_LOGIC',
          [e.id],
          e,
          ['PUBLIC_OBSERVATION'],
          this.entryConfidence(e),
          this.entryStatus(e),
          `API endpoint observed at ${e.public_url} (HTTP ${e.status}).`
        ));
      }
    }

    // From public_url hints in API evidence (e.g. API documentation references)
    for (const e of evidence) {
      if (!e.public_url || e.source_type !== 'PUBLIC_DOCUMENTATION') continue;
      const host = getCleanHostname(e.public_url);
      if (!isSameRootDomain(host, this.rootDomain)) continue;
      const text = e.raw_observation || e.evidence_text || '';
      const apiUrls = this.extractApiUrlsFromText(text);
      for (const apiUrl of apiUrls) {
        if (isSameRootDomain(getHostname(apiUrl), this.rootDomain)) {
          result.push(this.buildEntryPoint(
            apiUrl,
            'API_REST',
            'BUSINESS_LOGIC',
            [e.id],
            e,
            ['DOCUMENTATION_REFERENCE'],
            'MEDIUM',
            'DOCUMENTED_ONLY',
            `API endpoint referenced in documentation at ${e.public_url}.`
          ));
        }
      }
    }

    return result;
  }

  /** Phase 5: Identity surfaces. */
  private discoverIdentitySurfaces(
    evidence: Evidence[],
    surface: CompanySurface
  ): EntryPoint[] {
    const result: EntryPoint[] = [];

    // From evidence URLs
    for (const e of evidence) {
      if (!e.public_url) continue;
      const path = getUrlPath(e.public_url).toLowerCase();
      const host = getCleanHostname(e.public_url);

      if (!isSameRootDomain(host, this.rootDomain)) continue;

      let surfaceType: EntryPointSurfaceType | null = null;
      if (path.includes('/oauth') || path.includes('/oauth2')) surfaceType = 'IDENTITY_OAUTH';
      else if (path.includes('/oidc')) surfaceType = 'IDENTITY_OIDC';
      else if (path.includes('/sso') || path.includes('/saml')) surfaceType = 'IDENTITY_SSO';
      else if (path.includes('/password') || path.includes('/reset') || path.includes('/forgot'))
        surfaceType = 'IDENTITY_PASSWORD_RESET';
      else if (path.includes('/login') || path.includes('/signin') || path.includes('/auth'))
        surfaceType = 'IDENTITY_LOGIN_SYSTEM';

      if (surfaceType) {
        result.push(this.buildEntryPoint(
          e.public_url,
          surfaceType,
          'AUTHENTICATION',
          [e.id],
          e,
          ['PUBLIC_OBSERVATION'],
          this.entryConfidence(e),
          this.entryStatus(e),
          `Identity surface discovered at ${e.public_url}.`
        ));
      }
    }

    // From HTML: look for OAuth/OIDC metadata endpoints
    for (const e of evidence) {
      if (!e.raw_observation) continue;
      const host = getCleanHostname(e.public_url || '');
      if (!isSameRootDomain(host, this.rootDomain)) continue;

      // .well-known/openid-configuration
      const wellKnownRe = /https?:\/\/[^"'\s<>]+\/\.well-known\/(?:openid-configuration|oauth-authorization-server|web-identity)/gi;
      let m;
      while ((m = wellKnownRe.exec(e.raw_observation || e.evidence_text || '')) !== null) {
        const url = normalizeUrl(m[0]);
        const host = getHostname(url);
        if (isSameRootDomain(host, this.rootDomain)) {
          result.push(this.buildEntryPoint(
            url,
            'IDENTITY_OIDC',
            'AUTHENTICATION',
            [e.id],
            e,
            ['DOCUMENTATION_REFERENCE'],
            'MEDIUM',
            'DOCUMENTED_ONLY',
            `OIDC configuration discovered via .well-known on ${e.public_url}.`
          ));
        }
      }
    }

    return result;
  }

  /** Phase 6: Client-side surfaces (JS bundles, configs, API URLs in JS). */
  private discoverClientSideSurfaces(evidence: Evidence[]): EntryPoint[] {
    const result: EntryPoint[] = [];

    for (const e of evidence) {
      if (!e.raw_observation) continue;
      const host = getCleanHostname(e.public_url);
      if (!isSameRootDomain(host, this.rootDomain)) continue;

      const text = e.raw_observation || e.evidence_text || '';

      // JS bundle references — deduplicate to one per hostname (not per file)
      const jsRe = /src=["']([^"']+\.js[^"']*)["']/gi;
      let m;
      const seenJsHosts = new Set<string>();
      while ((m = jsRe.exec(text)) !== null) {
        const jsUrl = normalizeUrl(new URL(m[1], e.public_url).href);
        const jsHost = getHostname(jsUrl);
        if (isSameRootDomain(jsHost, this.rootDomain) && !seenJsHosts.has(jsHost)) {
          seenJsHosts.add(jsHost);
          result.push(this.buildEntryPoint(
            `https://${jsHost}`,
            'CLIENT_JS_BUNDLE',
            'PRESENTATION',
            [e.id],
            e,
            ['PUBLIC_OBSERVATION'],
            'MEDIUM',
            'PUBLICLY_OBSERVABLE',
            `JavaScript bundle referenced at ${e.public_url}.`
          ));
        }
      }

      // API base URLs in JS
      const apiUrlRe = /(["'])(https?:\/\/[a-z0-9-]+\.(?:${this.rootDomain})(?::\d+)?(?:\/[^"'\s]*)?)\1/gi;
      const apiUrls = new Set<string>();
      while ((m = apiUrlRe.exec(text)) !== null) {
        apiUrls.add(normalizeUrl(m[2]));
      }
      for (const apiUrl of apiUrls) {
        const path = getUrlPath(apiUrl);
        if (path.includes('/api') || path.includes('/v1') || path.includes('graphql')) {
          result.push(this.buildEntryPoint(
            apiUrl,
            'CLIENT_API_BASE_URL',
            'BUSINESS_LOGIC',
            [e.id],
            e,
            ['PUBLIC_OBSERVATION'],
            'MEDIUM',
            'PUBLICLY_OBSERVABLE',
            `API base URL extracted from client-side JavaScript at ${e.public_url}.`
          ));
        }
      }

      // Source map references
      const smRe = /sourceMappingURL=([^"\s>]+)/gi;
      while ((m = smRe.exec(text)) !== null) {
        const smUrl = normalizeUrl(new URL(m[1], e.public_url).href);
        result.push(this.buildEntryPoint(
          smUrl,
          'CLIENT_SOURCE_MAP',
          'DEVELOPER_ACCESS',
          [e.id],
          e,
          ['PUBLIC_OBSERVATION'],
          'LOW',
          'PUBLICLY_OBSERVABLE',
          `Source map reference discovered at ${e.public_url}.`
        ));
      }
    }

    return result;
  }

  /** Phase 7: Security / operational surfaces. */
  private discoverSecuritySurfaces(
    evidence: Evidence[],
    surface: CompanySurface
  ): EntryPoint[] {
    const result: EntryPoint[] = [];

    // From page categories in surface
    for (const page of surface.discovered_pages || []) {
      const cat = page.category || '';
      const host = getHostname(page.url);
      if (!isSameRootDomain(host, this.rootDomain)) continue;

      let surfaceType: EntryPointSurfaceType | null = null;
      if (cat === 'security' || page.path?.includes('/security')) surfaceType = 'SECURITY_VULN_DISCLOSURE';
      else if (cat === 'status_ops' || page.path?.includes('/status')) surfaceType = 'SECURITY_STATUS_PAGE';

      if (surfaceType) {
        const evForPage = evidence.filter(e => normalizeUrl(e.public_url) === normalizeUrl(page.url));
        result.push(this.buildEntryPoint(
          page.url,
          surfaceType,
          'STATUS_MONITORING',
          evForPage.map(e => e.id),
          evForPage[0],
          evForPage.length > 0 ? ['PUBLIC_OBSERVATION'] : ['HTML_LINK'],
          evForPage.length > 0 ? this.entryConfidence(evForPage[0]) : 'MEDIUM',
          evForPage.length > 0 ? this.entryStatus(evForPage[0]) : 'PUBLICLY_OBSERVABLE',
          `Security/operational surface discovered: ${page.title || page.url}.`
        ));
      }
    }

    // From evidence: security.txt, .well-known
    for (const e of evidence) {
      if (!e.public_url) continue;
      const path = getUrlPath(e.public_url).toLowerCase();
      const host = getCleanHostname(e.public_url);
      if (!isSameRootDomain(host, this.rootDomain)) continue;

      if (path.includes('security.txt') && path.includes('.well-known')) {
        result.push(this.buildEntryPoint(
          e.public_url,
          'SECURITY_TXT',
          'SECURITY_GATEWAY',
          [e.id],
          e,
          ['PUBLIC_OBSERVATION'],
          this.entryConfidence(e),
          this.entryStatus(e),
          `security.txt discovered at ${e.public_url}.`
        ));
      }
    }

    return result;
  }

  /** Phase 8: Cloud surfaces (documented references only — never guessed). */
  private discoverCloudSurfaces(evidence: Evidence[]): EntryPoint[] {
    const result: EntryPoint[] = [];
    const cloudProviders = ['amazonaws', 'cloudfront', 'storage.googleapis', 'googleapis', 'blob.core.windows', 'azureedge', 'azurewebsites', 'cloudflare', 'vercel', 'netlify'];

    for (const e of evidence) {
      if (!e.raw_observation) continue;
      const text = e.raw_observation || e.evidence_text || '';
      const host = getCleanHostname(e.public_url);
      if (!isSameRootDomain(host, this.rootDomain)) continue;

      for (const provider of cloudProviders) {
        const re = new RegExp(`https?://[a-z0-9-]+\\.${provider.replace(/\./g, '\\.')}[^"'\\s<>]*`, 'gi');
        const seen = new Set<string>();
        let m;
        while ((m = re.exec(text)) !== null) {
          const url = normalizeUrl(m[0]);
          // Skip URLs embedded in CSS inline styles or containing HTML entities
          if (url.includes('&quot;') || url.includes('&amp;') || url.includes(';') || url.includes('mask-image') || url.includes('background') || url.includes('webkit')) continue;
          // Skip asset URLs (CSS, JS, images) from inline styles — they are not documented services
          if (url.match(/\.(css|js|svg|png|jpg|jpeg|ico|woff|woff2|ttf|eot)$/)) continue;
          if (seen.has(url)) continue;
          seen.add(url);
          result.push(this.buildEntryPoint(
            url,
            'CLOUD_PUBLIC_REFERENCE',
            'CONTENT_DELIVERY',
            [e.id],
            e,
            ['PUBLIC_OBSERVATION'],
            'MEDIUM',
            'DOCUMENTED_ONLY',
            `Cloud reference (${provider}) found in content at ${e.public_url}.`
          ));
        }
      }
    }

    return result;
  }

  /** Phase 9: Repository / developer ecosystem surfaces. */
  private discoverRepositorySurfaces(evidence: Evidence[]): EntryPoint[] {
    const result: EntryPoint[] = [];

    for (const e of evidence) {
      if (!e.raw_observation) continue;
      const host = getCleanHostname(e.public_url);
      if (!isSameRootDomain(host, this.rootDomain)) continue;

      // GitHub repo references
      const ghRe = /github\.com\/[a-z0-9_-]+\/[a-z0-9_.-]+/gi;
      let m;
      while ((m = ghRe.exec(e.raw_observation || e.evidence_text || '')) !== null) {
        result.push(this.buildEntryPoint(
          m[0],
          'REPO_GITHUB',
          'DEVELOPER_ACCESS',
          [e.id],
          e,
          ['PUBLIC_OBSERVATION'],
          'MEDIUM',
          'PUBLICLY_OBSERVABLE',
          `GitHub repository referenced at ${e.public_url}.`
        ));
      }

      // SDK / npm package references
      const sdkRe = /(?:npm|pip|go|pypi|gem|cargo|cargo)\.?\s+(?:install|package)\s+["']?[a-z0-9_-]+["']?/gi;
      while ((m = sdkRe.exec(e.raw_observation || e.evidence_text || '')) !== null) {
        result.push(this.buildEntryPoint(
          m[0],
          'REPO_PUBLIC_SDK',
          'DEVELOPER_ACCESS',
          [e.id],
          e,
          ['DOCUMENTATION_REFERENCE'],
          'MEDIUM',
          'DOCUMENTED_ONLY',
          `SDK/package reference found at ${e.public_url}.`
        ));
      }
    }

    return result;
  }

  /** Phase 10: Legacy surfaces (from evidence mentioning deprecated/migration). */
  private discoverLegacySurfaces(evidence: Evidence[]): EntryPoint[] {
    const result: EntryPoint[] = [];
    // Only match explicit deprecation/migration language — not substrings in HTML/CSS
    const legacyIndicators = [
      'deprecated', 'deprecation', 'sunsetting', 'end-of-life',
      'is deprecated', 'will be deprecated', 'has been deprecated',
      'migrating from', 'migration from', 'legacy endpoint',
      'superseded by', 'no longer supported', 'retired',
    ];

    for (const e of evidence) {
      if (!e.public_url) continue;
      const text = (e.raw_observation || e.evidence_text || '').toLowerCase();
      const host = getCleanHostname(e.public_url);
      if (!isSameRootDomain(host, this.rootDomain)) continue;

      for (const indicator of legacyIndicators) {
        if (text.includes(indicator)) {
          result.push(this.buildEntryPoint(
            e.public_url,
            'LEGACY_DEPRECATED_API',
            'BUSINESS_LOGIC',
            [e.id],
            e,
            ['DOCUMENTATION_REFERENCE'],
            'MEDIUM',
            'LEGACY',
            `Legacy/deprecated surface reference found at ${e.public_url} (keyword: ${indicator}).`
          ));
          break;
        }
      }
    }

    return result;
  }

  /** Phase 11: Adaptive pivot surfaces. */
  private discoverAdaptiveSurfaces(evidence: Evidence[]): EntryPoint[] {
    const result: EntryPoint[] = [];
    for (const e of evidence) {
      if (!e.public_url) continue;
      // Check for adaptive observation
      if (e.evidence_origin === 'REAL_PUBLIC_OBSERVATION' && e.observation_type === 'ADAPTIVE_INVESTIGATION_PIVOT') {
        const host = getCleanHostname(e.public_url);
        if (isSameRootDomain(host, this.rootDomain) && host !== this.rootDomain) {
          result.push(this.buildEntryPoint(
            e.public_url,
            'DOMAIN_SUBDOMAIN',
            'PRESENTATION',
            [e.id],
            e,
            ['ADAPTIVE_PIVOT'],
            'MEDIUM',
            this.entryStatus(e),
            `Entry point discovered via adaptive investigation pivot.`
          ));
        }
      }
    }
    return result;
  }

  /** Extract API URLs from text content. */
  private extractApiUrlsFromText(text: string): string[] {
    const urls: string[] = [];
    const re = /https?:\/\/[a-z0-9-._~:/?#[\]@!$&'()*+,;=%]+/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      try {
        const url = normalizeUrl(m[0]);
        const path = getUrlPath(url);
        if (path.includes('/api') || path.includes('/v1') || path.includes('graphql') || path.includes('/v') && path.match(/\/v\d+/)) {
          urls.push(url);
        }
      } catch {}
    }
    return Array.from(new Set(urls));
  }

  /** Determine confidence based on evidence quality. */
  private entryConfidence(evidence?: Evidence): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (!evidence) return 'MEDIUM';
    if (evidence.repeatable) return 'HIGH';
    if (evidence.status === 200 && evidence.tested_without_auth) return 'HIGH';
    if (evidence.status && evidence.status >= 400) return 'MEDIUM';
    return 'MEDIUM';
  }

  /** Determine status from evidence. */
  private entryStatus(evidence: Evidence): EntryPointStatus {
    if (!evidence.tested_without_auth) return 'UNCONFIRMED';
    const status = evidence.status;
    if (status === 200) {
      if (evidence.repeatable) return 'VERIFIED_BEHAVIOR';
      return 'PUBLICLY_OBSERVABLE';
    }
    if (status === 401) return 'AUTHENTICATION_REQUIRED';
    if (status === 403) return 'AUTHORIZATION_REQUIRED';
    if (status && status >= 500) return 'UNCONFIRMED';
    return 'DOCUMENTED_ONLY';
  }

  /** Build an EntryPoint from components. */
  private buildEntryPoint(
    surfaceUrl: string,
    surfaceType: EntryPointSurfaceType,
    functionalRole: EntryPointFunctionalRole,
    evidenceIds: string[],
    primaryEvidence: Evidence | undefined,
    discoverySources: EntryPointDiscoverySource[],
    confidence: 'LOW' | 'MEDIUM' | 'HIGH',
    status: EntryPointStatus,
    uncertainty: string,
    protocol: EntryPointProtocol = 'HTTPS',
    method: string = 'GET',
    authModel: EntryPointAuthModel = 'UNKNOWN',
    authzModel: EntryPointAuthzModel = 'UNKNOWN',
    tenant: EntryPointTenantBoundary = 'UNKNOWN',
    env: EntryPointEnvironment = 'PRODUCTION',
    techContext: EntryPointTechContext = 'UNKNOWN',
  ): EntryPoint {
    const host = getCleanHostname(surfaceUrl);
    const now = new Date().toISOString();
    const canonicalUrl = normalizeUrl(surfaceUrl);
    const isContextArtifact = CONTEXT_ARTIFACT_SURFACE_TYPES.has(surfaceType);

    // Determine attribution — must have evidence, never just hostname-in-HTML
    const sameOrg = isSameRootDomain(host, this.rootDomain);
    const attributionConfidence = sameOrg ? 'HIGH' : 'MEDIUM';

    const attribution: EntryPointAttribution = {
      organization_id: this.orgId,
      canonical_domain: this.canonicalDomain,
      attribution_confidence: attributionConfidence,
      attribution_evidence_ids: evidenceIds,
      ownership_evidence: primaryEvidence
        ? [`${primaryEvidence.observed_behavior} on ${primaryEvidence.public_url} (HTTP ${primaryEvidence.status})`]
        : ['Subdomain shares root domain with canonical organization domain.'],
    };

    const observability: EntryPointObservability = {
      observed: !!primaryEvidence,
      status_code: primaryEvidence?.status ?? undefined,
      latency_ms: primaryEvidence?.latency_ms ?? undefined,
      latency_samples: primaryEvidence?.latency_samples,
      repeatable: primaryEvidence?.repeatable ?? false,
      reproductions: primaryEvidence?.reproductions ?? 0,
      http_method: method,
      content_type: undefined,
      response_size_bytes: undefined,
    };

    // Compute verification eligibility with reason codes
    const { eligible, reasonCodes } = this.computeVerificationEligibility(surfaceType, evidenceIds, primaryEvidence, status);
    const verification: VerificationEligibility = {
      eligible,
      can_verify: [],
      requires_auth: [],
      cannot_verify: [],
      confidence: evidenceIds.length > 0 ? 'HIGH' : 'LOW',
      ineligibility_reasons: reasonCodes,
    };

    // Build can_verify / cannot_verify arrays
    if (eligible) {
      verification.can_verify.push('HTTP status code');
      verification.can_verify.push('Response latency');
      if (primaryEvidence?.repeatable) {
        verification.can_verify.push('Response reproducibility');
      }
    } else {
      for (const reason of reasonCodes) {
        verification.cannot_verify.push(reasonCodeToDescription(reason));
      }
    }

    return {
      entry_point_id: entryPointId(this.orgId, this.canonicalDomain, canonicalUrl, surfaceType),
      organization_id: this.orgId,
      canonical_domain: this.canonicalDomain,
      surface_url: normalizeUrl(surfaceUrl),
      canonical_url: canonicalUrl,
      hostname: host,
      reference: primaryEvidence ? primaryEvidence.public_url : 'SurfaceDiscovery',
      surface_type: surfaceType,
      semantic_roles: [surfaceType],
      functional_role: functionalRole,
      protocol,
      method,
      authentication_model: authModel,
      authorization_model: authzModel,
      tenant_boundary: tenant,
      environment: env,
      technology_context: techContext,
      discovery_source: discoverySources,
      provenance: (primaryEvidence?.evidence_origin as EvidenceProvenance) || 'REAL_PUBLIC_OBSERVATION',
      attribution,
      observability,
      verification_eligibility: verification,
      confidence,
      first_seen: primaryEvidence?.retrieved_at || now,
      last_seen: primaryEvidence?.retrieved_at || now,
      evidence_ids: evidenceIds,
      relationships: [],
      is_context_artifact: isContextArtifact,
      uncertainty,
      status,
    };
  }

  /** Phase 12: Cross-source confirmation. */
  private annotateCrossSource(eps: EntryPoint[], evidence: Evidence[]): void {
    for (const ep of eps) {
      if (ep.evidence_ids.length > 1) {
        // If multiple evidence IDs confirm the same entry point, boost confidence
        if (ep.confidence === 'MEDIUM' && ep.evidence_ids.length >= 2) {
          ep.confidence = 'HIGH';
        }
      }
      // Check if the same hostname appears in multiple discovery sources
      const hostEps = eps.filter(e => e.hostname === ep.hostname);
      if (hostEps.length > 1) {
        ep.discovery_source = [...new Set([...ep.discovery_source, ...hostEps.flatMap(h => h.discovery_source)])] as EntryPointDiscoverySource[];
      }
    }
  }

  /** Compute verification eligibility for an entry point.
   *
   * Only an entry point that is:
   *   - actually externally observable (PUBLICLY_OBSERVABLE or VERIFIED_BEHAVIOR)
   *   - attributable to the organization (on the canonical root domain)
   *   - currently relevant (not LEGACY/HISTORICAL)
   *   - technically meaningful (not a framework asset or third-party CDN reference)
   *   - legitimately observable without crossing an authorization boundary
   *
   * may be verification-eligible in PUBLIC mode.
   */
  private computeVerificationEligibility(
    surfaceType: EntryPointSurfaceType,
    evidenceIds: string[],
    primaryEvidence: Evidence | undefined,
    status: EntryPointStatus
  ): { eligible: boolean; reasonCodes: IneligibilityReason[] } {
    const reasonCodes: IneligibilityReason[] = [];

    // Context artifacts are never verification-eligible as runtime surfaces
    if (CONTEXT_ARTIFACT_SURFACE_TYPES.has(surfaceType)) {
      if (surfaceType === 'CLIENT_JS_BUNDLE' || surfaceType === 'CLIENT_SOURCE_MAP' || surfaceType === 'CLIENT_FRONTEND_CONFIG'
          || surfaceType === 'CLIENT_PUBLIC_CONFIG' || surfaceType === 'CLIENT_DATA_ATTRIBUTE' || surfaceType === 'CLIENT_EMBEDDED_JSON'
          || surfaceType === 'CLIENT_SERVICE_WORKER' || surfaceType === 'CLIENT_BROWSER_REQUEST') {
        reasonCodes.push('CLIENT_JS_BUNDLE');
      } else if (surfaceType === 'CLOUD_PUBLIC_REFERENCE' || surfaceType === 'CLOUD_STORAGE_REFERENCE'
                 || surfaceType === 'CLOUD_CDN_REFERENCE' || surfaceType === 'CLOUD_DEPLOYMENT_REFERENCE'
                 || surfaceType === 'CLOUD_INFRA_DOC') {
        reasonCodes.push('CLOUD_PUBLIC_REFERENCE');
      } else {
        reasonCodes.push('CONTEXT_ARTIFACT');
      }

      return { eligible: false, reasonCodes };
    }

    // Status-based ineligibility — LEGACY, ATTRIBUTED, AUTH_REQUIRED, DOCUMENTED_ONLY
    if (INELIGIBLE_STATUSES.has(status)) {
      if (status === 'LEGACY' || status === 'HISTORICAL') {
        reasonCodes.push('LEGACY_SURFACE');
      } else if (status === 'ATTRIBUTED') {
        reasonCodes.push('ATTRIBUTED_ONLY_NOT_OBSERVED');
      } else if (status === 'AUTHORIZATION_REQUIRED') {
        reasonCodes.push('AUTHORIZATION_REQUIRED');
      } else if (status === 'AUTHENTICATION_REQUIRED') {
        reasonCodes.push('AUTHENTICATION_REQUIRED');
      } else if (status === 'DOCUMENTED_ONLY') {
        reasonCodes.push('DOCUMENTED_ONLY');
      } else if (status === 'UNCONFIRMED' || status === 'DISCOVERED') {
        reasonCodes.push('NOT_EXTERNALLY_OBSERVABLE');
      } else if (status === 'REJECTED') {
        reasonCodes.push('NOT_ATTRIBUTABLE');
      }
      return { eligible: false, reasonCodes };
    }

    // Must be externally observable
    if (status !== 'PUBLICLY_OBSERVABLE' && status !== 'VERIFIED_BEHAVIOR') {
      reasonCodes.push('NOT_EXTERNALLY_OBSERVABLE');
      return { eligible: false, reasonCodes };
    }

    // Must have evidence
    if (evidenceIds.length === 0) {
      reasonCodes.push('NOT_ATTRIBUTABLE');
      return { eligible: false, reasonCodes };
    }

    return { eligible: true, reasonCodes };
  }

  /** Phase 12: Canonical URL collision merging.
   *
   * When the same canonical URL produces multiple entry points with different
   * surface types, merge them into a single entry point with semantic_roles.
   * The primary surface_type is chosen by specificity priority; all types are
   * preserved in semantic_roles.
   *
   * Post-merge, re-evaluate verification eligibility: if ANY merged semantic
   * role is a context artifact or legacy type, the merged entry is ineligible.
   */
  private mergeCanonicalCollisions(eps: EntryPoint[]): EntryPoint[] {
    const byCanonicalUrl = new Map<string, EntryPoint[]>();
    const collisionGroups: string[] = [];

    for (const ep of eps) {
      const key = ep.canonical_url;
      if (!byCanonicalUrl.has(key)) {
        byCanonicalUrl.set(key, []);
      }
      byCanonicalUrl.get(key)!.push(ep);
    }

    // Find collision groups
    for (const [url, group] of byCanonicalUrl.entries()) {
      if (group.length > 1) {
        collisionGroups.push(url);
      }
    }

    if (collisionGroups.length === 0) return eps;

    // Surface type priority: lower = more specific, kept as primary
    // Most specific types that uniquely identify a surface
    const typePriority: Record<string, number> = {
      'SECURITY_STATUS_PAGE': 0,
      'SECURITY_TXT': 0, 'SECURITY_VULN_DISCLOSURE': 0, 'SECURITY_TRUST_PAGE': 0,
      'SECURITY_INCIDENT_PAGE': 0, 'SECURITY_HEALTH_ENDPOINT': 0,
      // Specific API/identity types
      'API_REST': 0, 'API_GRAPHQL': 0, 'API_VERSIONED': 0, 'API_WEBHOOK_RECEIVER': 0,
      'API_CALLBACK': 0, 'API_GATEWAY': 0, 'API_STREAMING': 0,
      'IDENTITY_OAUTH': 0, 'IDENTITY_OIDC': 0, 'IDENTITY_SSO': 0,
      'IDENTITY_LOGIN_SYSTEM': 0, 'IDENTITY_PASSWORD_RESET': 0,
      'IDENTITY_ACCOUNT_RECOVERY': 0,
      // Specific auth/account types
      'WEBSITE_LOGIN': 0, 'WEBSITE_SIGNUP': 0, 'WEBSITE_PASSWORD_RECOVERY': 1,
      'WEBSITE_ACCOUNT_PORTAL': 1, 'WEBSITE_ADMIN_INTERFACE': 1,
      'WEBSITE_DEVELOPER_PORTAL': 1, 'WEBSITE_APPLICATION': 1,
      // Specific page types
      'WEBSITE_PRODUCT_PAGE': 1, 'WEBSITE_PLAYGROUND': 1, 'WEBSITE_DEMO': 1,
      'WEBSITE_DASHBOARD': 1, 'WEBSITE_CUSTOMER_PORTAL': 1,
      'WEBSITE_MOBILE_WEB': 1, 'WEBSITE_EMBEDDED_APP': 1, 'WEBSITE_REGIONAL_APP': 1,
      'API_REFERENCE': 1, 'API_DOCUMENTATION': 1,
      'DOMAIN_API': 1, 'DOMAIN_DOCUMENTATION': 1, 'DOMAIN_LOGIN': 1,
      'DOMAIN_STATUS': 1, 'DOMAIN_SUPPORT': 1, 'DOMAIN_DEVELOPER': 1,
      'DOMAIN_PRODUCT': 1,
      // Homepage (general but meaningful)
      'WEBSITE_HOMEPAGE': 2,
      // Least specific — organizational containers
      'DOMAIN_CANONICAL': 3, 'DOMAIN_SUBDOMAIN': 3, 'DOMAIN_CDN': 3,
    };

    // Merge: keep the entry point with highest priority (lowest numeric value) as primary
    const result: EntryPoint[] = [];
    const merged = new Set<string>();

    for (const [url, group] of byCanonicalUrl.entries()) {
      if (group.length === 1) {
        result.push(group[0]);
        merged.add(group[0].entry_point_id);
        continue;
      }

      // Pick primary: lowest priority number, then highest confidence
      const primary = group.reduce((best, ep) => {
        const bestPrio = typePriority[best.surface_type] ?? 3;
        const epPrio = typePriority[ep.surface_type] ?? 3;
        if (epPrio < bestPrio) return ep;
        if (bestPrio < epPrio) return best;
        // Same priority — pick higher confidence
        if (ep.confidence === 'HIGH' && best.confidence !== 'HIGH') return ep;
        if (best.confidence === 'HIGH' && ep.confidence !== 'HIGH') return best;
        return best;
      }, group[0]);

      // Collect all unique surface types as semantic_roles
      const allRoles = [...new Set(group.map(ep => ep.surface_type))];
      primary.semantic_roles = allRoles;
      // Merge evidence IDs
      primary.evidence_ids = [...new Set(group.flatMap(ep => ep.evidence_ids))];
      // Merge discovery sources
      primary.discovery_source = [...new Set(group.flatMap(ep => ep.discovery_source))];
      // Merge relationships
      for (const ep of group) {
        if (ep.entry_point_id !== primary.entry_point_id) {
          primary.relationships.push(...ep.relationships);
          merged.add(ep.entry_point_id);
        }
      }
      // Context artifact if any merged EP was context
      primary.is_context_artifact = group.some(ep => ep.is_context_artifact);

      // Post-merge: re-evaluate verification eligibility if any merged semantic
      // role is a context artifact or legacy type. The merged entry inherits
      // the primary's status, but if ANY role is ineligible, the whole entry
      // is ineligible.
      const anyContextArtifact = group.some(ep => ep.is_context_artifact);
      const anyLegacyOrHistorical = group.some(ep => ep.status === 'LEGACY' || ep.status === 'HISTORICAL');
      const anyAuthRequired = group.some(ep => ep.status === 'AUTHORIZATION_REQUIRED' || ep.status === 'AUTHENTICATION_REQUIRED');
      const anyDocumentedOnly = group.some(ep => ep.status === 'DOCUMENTED_ONLY');
      const anyAttributed = group.some(ep => ep.status === 'ATTRIBUTED');

      if (anyContextArtifact || anyLegacyOrHistorical || anyAuthRequired || anyDocumentedOnly || anyAttributed) {
        const { eligible, reasonCodes } = this.computeVerificationEligibility(
          primary.surface_type, primary.evidence_ids, undefined, primary.status
        );
        // Override: even if primary says eligible, merged context/legacy roles make it ineligible
        if (anyContextArtifact || anyLegacyOrHistorical || anyAuthRequired || anyDocumentedOnly || anyAttributed) {
          primary.verification_eligibility.eligible = false;
          if (!primary.verification_eligibility.ineligibility_reasons) {
            primary.verification_eligibility.ineligibility_reasons = [];
          }
          // Add missing reason codes
          for (const ep of group) {
            if (ep.verification_eligibility.ineligibility_reasons) {
              for (const rc of ep.verification_eligibility.ineligibility_reasons) {
                if (!primary.verification_eligibility.ineligibility_reasons.includes(rc)) {
                  primary.verification_eligibility.ineligibility_reasons.push(rc);
                }
              }
            }
          }
          // Ensure at least LEGACY_SURFACE if any merged EP was legacy/historical
          if (anyLegacyOrHistorical && !primary.verification_eligibility.ineligibility_reasons.includes('LEGACY_SURFACE')) {
            primary.verification_eligibility.ineligibility_reasons.push('LEGACY_SURFACE');
          }
          if (anyDocumentedOnly && !primary.verification_eligibility.ineligibility_reasons.includes('DOCUMENTED_ONLY')) {
            primary.verification_eligibility.ineligibility_reasons.push('DOCUMENTED_ONLY');
          }
        }
      }

      result.push(primary);
    }

    return result;
  }
}
