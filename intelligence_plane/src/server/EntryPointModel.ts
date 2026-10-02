/**
 * VARDHAN — ENTRY POINT INTELLIGENCE (§ENTRY-POINT)
 * ─────────────────────────────────────────────────────────────────────────────
 * The Entry Point model captures every externally reachable technical surface
 * of an organization — not just the homepage or one API, but the full connected
 * graph of web, API, identity, client-side, DNS, cloud, repository, security,
 * data, mobile, and legacy entry points.
 *
 * Every entry point is backed by evidence and attribution. Nothing is guessed.
 * Hostnames are not treated as organizational assets without evidence.
 * Cloud-provider hostnames are not treated as proof of ownership.
 *
 * The model is purely descriptive: it maps WHAT exists and WHERE, not what to
 * attack. Security-research knowledge bases inform *what to look for*, never
 * *how to attack*.
 */

import type { EvidenceProvenance } from './DeepTypes';

// ── Surface Type Classification ───────────────────────────────────────────────

/**
 * The class of external-facing technical surface an entry point represents.
 * These map directly to the ENTRY-POINT DISCOVERY categories in the spec.
 */
export type EntryPointSurfaceType =
  // ── Web ──
  | 'WEBSITE_HOMEPAGE'
  | 'WEBSITE_PRODUCT_PAGE'
  | 'WEBSITE_APPLICATION'
  | 'WEBSITE_LOGIN'
  | 'WEBSITE_SIGNUP'
  | 'WEBSITE_PASSWORD_RECOVERY'
  | 'WEBSITE_ACCOUNT_PORTAL'
  | 'WEBSITE_DASHBOARD'
  | 'WEBSITE_ADMIN_INTERFACE'
  | 'WEBSITE_DEVELOPER_PORTAL'
  | 'WEBSITE_PUBLIC_TOOL'
  | 'WEBSITE_DEMO'
  | 'WEBSITE_PLAYGROUND'
  | 'WEBSITE_CUSTOMER_PORTAL'
  | 'WEBSITE_LEGACY_APP'
  | 'WEBSITE_REGIONAL_APP'
  | 'WEBSITE_MOBILE_WEB'
  | 'WEBSITE_EMBEDDED_APP'
  // ── API ──
  | 'API_REST'
  | 'API_GRAPHQL'
  | 'API_RPC'
  | 'API_WEBHOOK_RECEIVER'
  | 'API_CALLBACK'
  | 'API_PUBLIC_SDK_OPERATION'
  | 'API_REFERENCE'
  | 'API_DOCUMENTATION'
  | 'API_GATEWAY'
  | 'API_VERSIONED'
  | 'API_LEGACY'
  | 'API_STREAMING'
  // ── Identity ──
  | 'IDENTITY_LOGIN_SYSTEM'
  | 'IDENTITY_OAUTH'
  | 'IDENTITY_OIDC'
  | 'IDENTITY_SSO'
  | 'IDENTITY_SAML_REFERENCE'
  | 'IDENTITY_AUTH_PORTAL'
  | 'IDENTITY_PASSWORD_RESET'
  | 'IDENTITY_ACCOUNT_RECOVERY'
  // ── Client-side ──
  | 'CLIENT_JS_BUNDLE'
  | 'CLIENT_SOURCE_MAP'
  | 'CLIENT_FRONTEND_CONFIG'
  | 'CLIENT_API_BASE_URL'
  | 'CLIENT_PUBLIC_CONFIG'
  | 'CLIENT_DATA_ATTRIBUTE'
  | 'CLIENT_EMBEDDED_JSON'
  | 'CLIENT_SERVICE_WORKER'
  | 'CLIENT_BROWSER_REQUEST'
  // ── Domains / DNS / infrastructure ──
  | 'DOMAIN_CANONICAL'
  | 'DOMAIN_SUBDOMAIN'
  | 'DOMAIN_PRODUCT'
  | 'DOMAIN_DOCUMENTATION'
  | 'DOMAIN_STATUS'
  | 'DOMAIN_DEVELOPER'
  | 'DOMAIN_SUPPORT'
  | 'DOMAIN_LOGIN'
  | 'DOMAIN_REGIONAL'
  | 'DOMAIN_API'
  | 'DOMAIN_CLOUD_SERVICE'
  | 'DOMAIN_CDN'
  | 'DOMAIN_SERVICE_ALIAS'
  // ── Cloud ──
  | 'CLOUD_DOCUMENTED_SERVICE'
  | 'CLOUD_PUBLIC_REFERENCE'
  | 'CLOUD_STORAGE_REFERENCE'
  | 'CLOUD_CDN_REFERENCE'
  | 'CLOUD_DEPLOYMENT_REFERENCE'
  | 'CLOUD_SERVICE_ENDPOINT'
  | 'CLOUD_INFRA_DOC'
  // ── Repositories / developer ecosystem ──
  | 'REPO_GITHUB'
  | 'REPO_GITLAB'
  | 'REPO_PUBLIC_SDK'
  | 'REPO_EXAMPLE'
  | 'REPO_PACKAGE_DOC'
  | 'REPO_CI_CD_DOC'
  | 'REPO_IAC_REFERENCE'
  | 'REPO_ISSUE_DISCUSSION'
  | 'REPO_CONFIG_EXAMPLE'
  | 'REPO_INTEGRATION_DOC'
  // ── Security / operational ──
  | 'SECURITY_STATUS_PAGE'
  | 'SECURITY_INCIDENT_PAGE'
  | 'SECURITY_TRUST_PAGE'
  | 'SECURITY_VULN_DISCLOSURE'
  | 'SECURITY_TXT'
  | 'SECURITY_HEALTH_ENDPOINT'
  | 'SECURITY_METRICS_REFERENCE'
  | 'SECURITY_OBSERVABILITY_DOC'
  | 'SECURITY_SUPPORT_DIAGNOSTIC'
  // ── Data / file / content ──
  | 'DATA_PUBLIC_FILE'
  | 'DATA_DOWNLOAD'
  | 'DATA_DOCUMENT_REPOSITORY'
  | 'DATA_RSS_FEED'
  | 'DATA_ENDPOINT'
  | 'DATA_PUBLIC_EXPORT'
  | 'DATA_MEDIA_HOST'
  | 'DATA_OBJECT_REFERENCE'
  // ── Integration ──
  | 'INTEGRATION_PAYMENT'
  | 'INTEGRATION_CRM'
  | 'INTEGRATION_MESSAGING'
  | 'INTEGRATION_WEBHOOK_DOC'
  | 'INTEGRATION_PARTNER_API'
  | 'INTEGRATION_EMBEDDED_SERVICE'
  | 'INTEGRATION_AUTOMATION'
  // ── Mobile ──
  | 'MOBILE_PUBLIC_DOC'
  | 'MOBILE_DEEP_LINK'
  | 'MOBILE_API_REF'
  | 'MOBILE_PUBLIC_CONFIG'
  | 'MOBILE_PUBLIC_ENDPOINT'
  // ── Legacy ──
  | 'LEGACY_DEPRECATED_DOMAIN'
  | 'LEGACY_DEPRECATED_API'
  | 'LEGACY_MIGRATION_REMNANT'
  | 'LEGACY_HISTORICAL_DOC'
  | 'LEGACY_PREVIOUS_APP_PATH';

/** Broad functional role of the entry point. */
export type EntryPointFunctionalRole =
  | 'PRESENTATION'
  | 'AUTHENTICATION'
  | 'AUTHORIZATION'
  | 'DATA_ACCESS'
  | 'BUSINESS_LOGIC'
  | 'ADMINISTRATION'
  | 'DEVELOPER_ACCESS'
  | 'STATUS_MONITORING'
  | 'INCIDENT_MANAGEMENT'
  | 'SECURITY_GATEWAY'
  | 'CONTENT_DELIVERY'
  | 'API_GATEWAY'
  | 'SERVICE_PROXY'
  | 'STORAGE_ENDPOINT'
  | 'QUEUE_SERVICE'
  | 'CACHE_LAYER'
  | 'DATABASE_ENDPOINT'
  | 'SEARCH_SERVICE'
  | 'WEBHOOK_HANDLER'
  | 'CALLBACK_HANDLER'
  | 'THIRD_PARTY_INTEGRATION'
  | 'PARTNER_INTEGRATION'
  | 'AUTOMATION_TRIGGER';

/** Protocol(s) the entry point speaks. */
export type EntryPointProtocol =
  | 'HTTP' | 'HTTPS' | 'GRPC' | 'GRAPHQL' | 'WEBSOCKET'
  | 'TCP' | 'UDP' | 'DNS' | 'SMTP' | 'OTHER';

/** Authentication model observed or documented for the entry point. */
export type EntryPointAuthModel =
  | 'NONE' | 'API_KEY' | 'OAUTH' | 'OIDC' | 'SAML'
  | 'BASIC_AUTH' | 'SESSION_COOKIE' | 'CUSTOM_TOKEN'
  | 'MUTUAL_TLS' | 'UNKNOWN';

/** Authorization model observed or documented. */
export type EntryPointAuthzModel =
  | 'PUBLIC' | 'ROLE_BASED' | 'ATTRIBUTE_BASED'
  | 'POLICY_BASED' | 'NONE' | 'UNKNOWN';

/** Tenant boundary type. */
export type EntryPointTenantBoundary =
  | 'SINGLE_TENANT' | 'MULTI_TENANT' | 'ISOLATED' | 'UNKNOWN';

/** Deployment environment if discernible. */
export type EntryPointEnvironment =
  | 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT'
  | 'CANARY' | 'UNKNOWN';

/** Technology fingerprint if discernible from response headers, JS, or HTML. */
export type EntryPointTechContext =
  | 'NEXTJS' | 'REACT' | 'ANGULAR' | 'VUE' | 'SVELTE' | 'SVELTEKIT'
  | 'EXPRESS' | 'FASTIFY' | 'NODE' | 'PYTHON_DJANGO' | 'PYTHON_FLASK'
  | 'PYTHON_FASTAPI' | 'GO_NETHTTP' | 'SPRING_BOOT' | 'ASPNET'
  | 'NEXTAUTH' | 'COGNITO' | 'AUTH0' | 'FIREBASE' | 'SUPABASE'
  | 'STRIPE' | 'SALESFORCE' | 'NETLIFY' | 'VERCEL' | 'CLOUDFLARE'
  | 'AWS' | 'GCP' | 'AZURE' | 'STATUSPAGE_IO' | 'ATLASSIAN_STATUSPAGE'
  | 'GITHUB' | 'GITLAB' | 'SENTRY' | 'DATADOG' | 'ELASTIC' | 'NEW_RELIC'
  | 'OKTA' | 'NGINX' | 'CUSTOM' | 'UNKNOWN';

/** How the entry point was discovered. */
export type EntryPointDiscoverySource =
  | 'PUBLIC_OBSERVATION'
  | 'HTML_LINK'
  | 'SITEMAP'
  | 'ROBOTS_TXT'
  | 'CANONICAL_LINK'
  | 'SCRIPT_SRC'
  | 'JSON_LD_URL'
  | 'API_RESPONSE_FIELD'
  | 'SDK_CONFIGURATION'
  | 'SOURCE_MAP_REFERENCE'
  | 'STATUS_PAGE_REFERENCE'
  | 'INCIDENT_PAGE_REFERENCE'
  | 'DOCUMENTATION_REFERENCE'
  | 'GITHUB_REPOSITORY_LINK'
  | 'CNAME_RECORD'
  | 'SECURITY_TXT'
  | 'ADAPTIVE_PIVOT';

/** Classification states for an entry point. */
export type EntryPointStatus =
  | 'DISCOVERED'
  | 'ATTRIBUTED'
  | 'PUBLICLY_OBSERVABLE'
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHORIZATION_REQUIRED'
  | 'DOCUMENTED_ONLY'
  | 'VERIFICATION_ELIGIBLE'
  | 'VERIFIED_BEHAVIOR'
  | 'HISTORICAL'
  | 'LEGACY'
  | 'UNCONFIRMED'
  | 'REJECTED';

/** Relationship type between two entry points. */
export type EntryPointRelationType =
  | 'USES'
  | 'AUTHENTICATES'
  | 'DEPENDS_ON'
  | 'CALLS'
  | 'DOCUMENTS'
  | 'IMPLEMENTS'
  | 'REPRESENTS'
  | 'BELONGS_TO'
  | 'REPLACED_BY'
  | 'REFERENCES'
  | 'HOSTS'
  | 'REDIRECTS_TO'
  | 'ALIASES'
  | 'PROVIDES_AUTH_FOR'
  | 'PROXIES_TO'
  | 'INTEGRATES_WITH'
  // Reverse relation types (auto-generated for bidirectional queries)
  | 'CALLED_BY'
  | 'IMPLEMENTED_BY'
  | 'REFERENCED_BY'
  | 'DEPENDED_BY'
  | 'DOCUMENTED_BY'
  | 'SUPPORTED_BY'
  | 'INTEGRATED_BY'
  | 'USED_BY'
  | 'REPLACES'
  | 'ALIASED_BY'
  | 'AUTHENTICATED_BY'
  | 'AUTH_PROVIDED_BY'
  | 'REPRESENTED_BY'
  | 'OWNED_BY';

/** Change types for entry-point change detection. */
export type EntryPointChangeType =
  | 'NEW'
  | 'REMOVED'
  | 'CHANGED_STATUS'
  | 'CHANGED_OBSERVABILITY'
  | 'CHANGED_AUTH'
  | 'CHANGED_DOCUMENTATION'
  | 'CHANGED_TECHNOLOGY';

// ── Core Entry Point ──────────────────────────────────────────────────────────

/**
 * Attribution: why we believe this entry point belongs to this organization.
 * Every attribution must carry evidence IDs — never a bare hostname claim.
 */
export interface EntryPointAttribution {
  organization_id: string;
  canonical_domain: string;
  /** Confidence that the organization owns this surface. */
  attribution_confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Evidence IDs that back the attribution claim. */
  attribution_evidence_ids: string[];
  /** Verbatim evidence text (or excerpt) supporting ownership. */
  ownership_evidence: string[];
}

/**
 * Observability: what was actually observed when probing the entry point.
 * For documented-only entry points, `observed` is false and only the
 * documented reference is recorded.
 */
export interface EntryPointObservability {
  /** Whether a live request was successfully completed to this surface. */
  observed: boolean;
  /** HTTP status code if a live observation was made. */
  status_code?: number;
  /** Latency in milliseconds if measured. */
  latency_ms?: number;
  /** Latency samples if measured (reproducibility check). */
  latency_samples?: number[];
  /** Whether the observation was reproducible. */
  repeatable: boolean;
  /** Number of reproduction attempts. */
  reproductions: number;
  /** HTTP method used for observation. */
  http_method: string;
  /** Content-Type of the response, if observed. */
  content_type?: string;
  /** Response body size in bytes, if measured. */
  response_size_bytes?: number;
}

/** Explicit reason an entry point is not eligible for public verification. */
export type IneligibilityReason =
  | 'LEGACY_SURFACE'
  | 'ATTRIBUTED_ONLY_NOT_OBSERVED'
  | 'AUTHORIZATION_REQUIRED'
  | 'AUTHENTICATION_REQUIRED'
  | 'DOCUMENTED_ONLY'
  | 'CLIENT_JS_BUNDLE'
  | 'CLOUD_PUBLIC_REFERENCE'
  | 'NOT_EXTERNALLY_OBSERVABLE'
  | 'NOT_ATTRIBUTABLE'
  | 'CONTEXT_ARTIFACT';

/**
 * Verification eligibility: what can be proven about this entry point
 * from purely public observation.
 */
export interface VerificationEligibility {
  /** Whether this entry point can be verified via public observation in PUBLIC mode. */
  eligible: boolean;
  /** What verification could be performed. */
  can_verify: string[];
  /** What requires authentication to verify. */
  requires_auth: string[];
  /** What cannot currently be verified. */
  cannot_verify: string[];
  /** Confidence the verification approach is sound. */
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Structured reason codes for ineligibility. Empty when eligible. */
  ineligibility_reasons: IneligibilityReason[];
}

/**
 * A relationship from this entry point to another entry point.
 */
export interface EntryPointRelation {
  target_entry_point_id: string;
  target_surface_url: string;
  relationship: EntryPointRelationType;
  /** Confidence in this specific relationship. */
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Evidence IDs backing the relationship. */
  evidence_ids: string[];
  /** How this relation was derived. */
  basis?: EdgeBasis;
  /** Description of the evidence supporting this relation. */
  created_from?: string;
}

/**
 * A single externally-reachable technical entry point of an organization.
 * Every field is backed by evidence or explicitly marked as inferred.
 */
export interface EntryPoint {
  entry_point_id: string;
  organization_id: string;
  canonical_domain: string;
  /** The URL or hostname reference for this entry point. */
  surface_url: string;
  /** Canonical URL after fragment/tracking-param normalization — used for collision merging. */
  canonical_url: string;
  hostname: string;
  /** Free-form reference (e.g. HTML element, response field, doc section). */
  reference: string;
  surface_type: EntryPointSurfaceType;
  /** All surface-type classifications assigned to this canonical URL (multi-role). */
  semantic_roles: EntryPointSurfaceType[];
  /** Functional role of the primary surface type. */
  functional_role: EntryPointFunctionalRole;
  protocol: EntryPointProtocol;
  method: string;
  authentication_model: EntryPointAuthModel;
  authorization_model: EntryPointAuthzModel;
  tenant_boundary: EntryPointTenantBoundary;
  environment: EntryPointEnvironment;
  technology_context: EntryPointTechContext;
  discovery_source: EntryPointDiscoverySource[];
  provenance: EvidenceProvenance;
  attribution: EntryPointAttribution;
  observability: EntryPointObservability;
  verification_eligibility: VerificationEligibility;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  first_seen: string;
  last_seen: string;
  /** Evidence IDs supporting the existence of this entry point. */
  evidence_ids: string[];
  /** Related signal IDs from the DeepSignal layer. */
  related_signal_ids?: string[];
  /** Relationships to other entry points. */
  relationships: EntryPointRelation[];
  /** Whether this is a contextual artifact (JS bundle, CDN ref, repo mention) rather than a physical surface. */
  is_context_artifact: boolean;
  /** What we do not know about this entry point. */
  uncertainty: string;
  status: EntryPointStatus;
}

/**
 * Immutable snapshot of entry points for a single company at a point in time.
 */
export interface EntryPointSnapshot {
  organization_id: string;
  canonical_domain: string;
  collected_at: string;
  entry_points: EntryPoint[];
}

/**
 * Aggregate telemetry for entry-point discovery across a company.
 */
export interface EntryPointTelemetry {
  /** Total entry points discovered (including context artifacts). */
  total_discovered: number;
  /** Entry points with non-LOW attribution. */
  total_attributed: number;
  /** Entry points that are PUBLICLY_OBSERVABLE or VERIFIED_BEHAVIOR. */
  total_publicly_observable: number;
  /** Entry points with only documentation (no live observation). */
  total_documented_only: number;
  /** Entry points requiring authentication. */
  total_auth_required: number;
  /** Entry points eligible for public verification. */
  total_verification_eligible: number;
  /** Entry points with verified repeatable behavior. */
  total_verified: number;
  /** Entry points with historical/legacy status. */
  total_historical: number;
  /** Entry points explicitly rejected. */
  total_rejected: number;
  /** Surface type distribution. */
  by_surface_type: Record<string, number>;
  /** Technology context distribution. */
  by_technology: Record<string, number>;
  /** Authentication model distribution. */
  by_auth_model: Record<string, number>;
  /** Discovery source distribution. */
  by_discovery_source: Record<string, number>;
  /** Entry points confirmed by multiple evidence sources. */
  cross_source_confirmed: number;
  /** Adaptive investigation pivot entry points. */
  adaptive_entry_points: number;
  /** Adaptive pivot success rate. */
  adaptive_entry_point_success_rate: number;
  // ── CORRECTED METRICS (post-audit) ──────────────────────────────
  /** Physically distinct externally-reachable technical surfaces (excludes context artifacts). */
  physical_public_surfaces: number;
  /** Contextual artifacts that are not independently reachable surfaces. */
  context_artifacts: number;
  /** Entry points with ELIGIBLE verification status (authorized mode). */
  authorized_only_surfaces: number;
  /** Entry points with LEGACY or HISTORICAL status. */
  historical_surfaces: number;
  /** Entry points with DOCUMENTED_ONLY status. */
  documented_only_surfaces: number;
  /** Organization count (always 1 per company telemetry). */
  organization_count: number;
}

/**
 * A change in an entry point between two runs.
 */
export interface EntryPointChange {
  entry_point_id: string;
  change_type: EntryPointChangeType;
  surface_url: string;
  old_status: EntryPointStatus | null;
  new_status: EntryPointStatus | null;
  /** The specific fields that changed. */
  changed_fields: string[];
  old_values: Partial<EntryPoint> | null;
  new_values: Partial<EntryPoint> | null;
  evidence_ids: string[];
  observed_at: string;
}

/**
 * Full entry-point discovery result for a single organization.
 */
export interface EntryPointDiscoveryResult {
  organization_id: string;
  canonical_domain: string;
  entry_points: EntryPoint[];
  relationships: EntryPointRelation[];
  telemetry: EntryPointTelemetry;
  graph: EntryPointGraph;
}

/**
 * Directed graph of entry-point relationships.
 * Nodes are entry_point_ids; edges carry typed, evidence-backed relationships.
 */
export interface EntryPointGraph {
  nodes: string[];
  edges: EntryPointEdge[];
  /** Aggregate graph metrics with numerators/denominators. */
  metrics: EntryPointGraphMetrics;
}

/** Metrics about the graph, computed from edges. */
export interface EntryPointGraphMetrics {
  /** Total raw edge count before any deduplication. */
  raw_edges: number;
  /** Edges that carry at least one evidence_id (numerator). */
  evidence_backed_edges: number;
  /** Edges created from heuristic inference without direct evidence. */
  inferred_edges: number;
  /** Edges with zero evidence_ids (numerator). */
  edges_without_evidence: number;
  /** Duplicate edges removed (numerator). */
  duplicate_edges: number;
  /** Reciprocal edge pairs where A→B and B→A both exist (numerator). */
  reciprocal_pairs: number;
  /** Edges remaining after deduplication and evidence filtering (denominator). */
  canonical_edges: number;
  /** raw_edges denominator for inference ratio. */
  raw_edges_denominator: number;
}

/** Basis for creating a graph edge. */
export type EdgeBasis =
  | 'SHARED_EVIDENCE'          // Both endpoints observed in same evidence record
  | 'EXPLICIT_REFERENCE'       // Evidence text explicitly mentions the relationship
  | 'SAME_ROOT_DOMAIN'         // Inferred from hostname similarity (must be downgraded)
  | 'DEPRECATION_REFERENCE'    // Evidence text mentions deprecation/migration
  | 'REVERSE_OF'               // Auto-generated reverse of an evidence-backed edge
  | 'INFERRED';                // Heuristic, no direct evidence

export interface EntryPointEdge {
  /** Unique edge identifier. */
  edge_id: string;
  source_entry_point_id: string;
  target_entry_point_id: string;
  /** Legacy alias for source_entry_point_id. */
  from: string;
  /** Legacy alias for target_entry_point_id. */
  to: string;
  relation: EntryPointRelationType;
  /** Legacy alias for relation. */
  relationship: EntryPointRelationType;
  /** Evidence IDs backing this edge. Empty array if inferred. */
  evidence_ids: string[];
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  /** How this edge was derived. */
  basis: EdgeBasis;
  /** Human-readable description of the evidence supporting this edge. */
  created_from: string;
  /** Whether this edge is a reciprocal (reverse) of another edge. */
  is_reciprocal: boolean;
}
