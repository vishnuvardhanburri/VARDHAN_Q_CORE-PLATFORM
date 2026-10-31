/**
 * VARDHAN Q-CORE — Command Console API client.
 *
 * Real session auth against the Rust control plane (`auth_service`):
 * - POST /api/v1/auth/login {username,password} -> 200 {token,expires_in}
 *   | 202 {status:"mfa_required",challenge_id,expires_at_ms} | 401 {error}
 * - Every protected route requires `Authorization: Bearer <token>`.
 *   Without it the backend answers 401 "Missing or malformed Authorization
 *   header" — this client always attaches the stored session token, which is
 *   exactly what the old mock-first frontend never did.
 * - The backend rotates the session token on every authenticated response
 *   (`authorization-new-token: Bearer <new>`). This client honors rotation
 *   transparently so long-lived consoles never replay a stale token.
 *
 * No mock fallbacks: failures surface as typed ApiError so the UI can show
 * honest empty/error states instead of fabricated telemetry.
 */

export const API_BASE: string = (() => {
  const envUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (envUrl && envUrl.length > 0) {
    return envUrl;
  }
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    return window.location.origin;
  }
  return 'http://localhost:8080';
})();

const TOKEN_KEY = 'vardhan.console.session_token';
const ORG_KEY = 'vardhan.console.org_id';

type SessionInvalidListener = () => void;
let sessionInvalidListener: SessionInvalidListener | null = null;

export function onSessionInvalid(listener: SessionInvalidListener | null): void {
  sessionInvalidListener = listener;
}

function notifySessionInvalid(): void {
  clearToken();
  if (sessionInvalidListener) sessionInvalidListener();
}

// ── Token store: in-memory mirror + sessionStorage ───────────────────────────
// Session tokens are kept strictly in-memory and per-tab sessionStorage,
// preventing long-term persistence in insecure unencrypted localStorage.
// The backend sets HttpOnly session cookies; the in-memory mirror provides
// synchronous Bearer tokens for API client consumption.
let memoryToken: string | null | undefined;

function readStored(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === TOKEN_KEY) memoryToken = event.newValue;
  });
}

export function getToken(): string | null {
  if (memoryToken !== undefined) return memoryToken;
  memoryToken = readStored();
  return memoryToken;
}

export function storeToken(token: string): void {
  memoryToken = token;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable — session stays in memory only */
  }
}

export function clearToken(): void {
  memoryToken = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function getStoredOrg(): string | null {
  try {
    return sessionStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}

export function storeOrg(orgId: string): void {
  try {
    sessionStorage.setItem(ORG_KEY, orgId);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number;
  code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function storeRotation(res: Response): void {
  const rotated = res.headers.get('authorization-new-token');
  if (rotated) {
    const token = rotated.startsWith('Bearer ') ? rotated.slice(7) : rotated;
    if (token.trim().length > 0) storeToken(token.trim());
  }
}

// Serialize session-aware requests through a promise chain so rotation is
// adopted in order: each request reads the freshest token stored by its
// predecessor instead of firing N concurrent copies of the same stale token.
// Session-unaware calls (login, public reachability probes) bypass the chain.
let sessionQueue: Promise<unknown> = Promise.resolve();

async function runSessionAware<T>(task: () => Promise<T>): Promise<T> {
  const next = sessionQueue.then(task, task);
  // Keep the chain alive across failures; this link's rejection still reaches
  // the caller through `next`, while later requests queue behind a resolved
  // promise instead of a rejected one.
  sessionQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function parseError(res: Response): Promise<{ message: string; code?: string }> {
  try {
    const body = (await res.json()) as { error?: unknown; code?: unknown };
    let message = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    if (message.includes('Missing or malformed Authorization header') || message.includes('Invalid or expired session')) {
      message = 'Session expired or not authenticated. Please sign in again.';
    }
    const code = typeof body.code === 'string' ? body.code : undefined;
    return { message, code };
  } catch {
    return { message: `HTTP ${res.status}` };
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Set false for the public login/logout calls that must not trigger a session reset loop. */
  sessionAware?: boolean;
  /** Set true for unauthenticated probes (login-screen plane check): no token
      is attached, so a stale stored token can neither rotate nor revoke. */
  anonymous?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, sessionAware = true, anonymous = false } = options;
  const forward: RequestOptions = { method, body, sessionAware, anonymous };
  if (!sessionAware) return requestOnce<T>(path, forward);
  return runSessionAware(() => requestOnce<T>(path, forward));
}

async function requestOnce<T>(path: string, options: RequestOptions): Promise<T> {
  const { method = 'GET', body, sessionAware = true, anonymous = false } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  // Anonymous probes never attach a token: a stale stored token must not
  // rotate, must not revoke, and must not flip the reachability badge — the
  // badge answers "can I reach the plane", not "am I logged in".
  const token = anonymous ? null : getToken();
  if (!anonymous && !token && sessionAware) {
    notifySessionInvalid();
    throw new ApiError(401, 'Session expired or not authenticated. Please sign in again.');
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let payload: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload, credentials: 'include' });
  } catch (err) {
    throw new ApiError(0, err instanceof Error ? `Network error: ${err.message}` : 'Network error');
  }
  storeRotation(res);
  if (res.status === 401 && sessionAware) notifySessionInvalid();
  if (!res.ok) {
    const { message, code } = await parseError(res);
    throw new ApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as unknown as T;
  const text = await res.text();
  if (text.length === 0) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface LoginSuccess {
  kind: 'authenticated';
  token: string;
  expiresIn: number;
}

export interface LoginMfa {
  kind: 'mfa_required';
  challengeId: string;
  expiresAtMs: number;
}

export async function login(username: string, password: string): Promise<LoginSuccess | LoginMfa> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ username, password }),
    credentials: 'include',
  });
  if (res.status === 202) {
    const body = (await res.json()) as { challenge_id?: string; expires_at_ms?: number };
    if (!body.challenge_id) throw new ApiError(202, 'MFA challenge missing challenge_id');
    return { kind: 'mfa_required', challengeId: body.challenge_id, expiresAtMs: body.expires_at_ms ?? 0 };
  }
  if (!res.ok) {
    const { message } = await parseError(res);
    throw new ApiError(res.status, message);
  }
  const body = (await res.json()) as { token?: string; expires_in?: number };
  if (!body.token) throw new ApiError(200, 'Login response missing token');
  storeToken(body.token);
  return { kind: 'authenticated', token: body.token, expiresIn: body.expires_in ?? 0 };
}

export async function verifyMfa(challengeId: string, code: string): Promise<LoginSuccess> {
  const res = await fetch(`${API_BASE}/api/v1/auth/mfa/verify`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge_id: challengeId, code }),
    credentials: 'include',
  });
  if (!res.ok) {
    const { message } = await parseError(res);
    throw new ApiError(res.status, message);
  }
  const body = (await res.json()) as { token?: string; expires_in?: number };
  if (!body.token) throw new ApiError(200, 'MFA response missing token');
  storeToken(body.token);
  return { kind: 'authenticated', token: body.token, expiresIn: body.expires_in ?? 0 };
}

export async function logout(): Promise<void> {
  try {
    await request<unknown>('/api/v1/auth/logout', { method: 'POST', sessionAware: false });
  } finally {
    clearToken();
  }
}

export interface MeResponse {
  username: string;
  authenticated: boolean;
}

export function me(): Promise<MeResponse> {
  return request<MeResponse>('/api/v1/me');
}

export interface SessionInfo {
  username: string;
  issued_at_ms: number;
  expires_in: number;
}

export function sessionInfo(): Promise<SessionInfo> {
  return request<SessionInfo>('/api/v1/auth/session');
}

// ── Platform (public) ────────────────────────────────────────────────────────

export interface PlatformHealth {
  service: string;
  status: string;
  mode: string;
  authentication: string;
  demo_authentication: boolean;
  transport: string;
  tls_enabled: boolean;
  client_auth: string;
}

export function platformHealth(): Promise<PlatformHealth> {
  return request<PlatformHealth>('/api/v1/platform/health', { sessionAware: false, anonymous: true });
}

// ── Organizations ────────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  owner: string;
  created_at_ms: number;
}

export interface OrganizationList {
  organizations: Organization[];
}

export function listOrganizations(): Promise<OrganizationList> {
  return request<OrganizationList>('/api/v1/organizations');
}

export function createOrganization(name: string): Promise<{ organization: Organization } | Organization> {
  return request<{ organization: Organization } | Organization>('/api/v1/organizations', {
    method: 'POST',
    body: { name },
  });
}

export interface MemberEntry {
  username: string;
  role: string;
}
export type MemberRecord = MemberEntry;

export interface MemberList {
  organization_id: string;
  members: MemberEntry[];
}

export function listMembers(orgId: string): Promise<MemberList> {
  return request<MemberList>(`/api/v1/organizations/${encodeURIComponent(orgId)}/members`);
}

export interface Subscription {
  organization_id: string;
  plan_id: string;
  status: string;
  provider: string;
  external_customer_id?: string | null;
  external_subscription_id?: string | null;
}

export function getSubscription(orgId: string): Promise<{ subscription: Subscription }> {
  return request<{ subscription: Subscription }>(
    `/api/v1/organizations/${encodeURIComponent(orgId)}/subscription`,
  );
}

export interface Usage {
  organization_id: string;
  transactions: number;
  bytes_processed: number;
}
export type UsageSummary = Usage;

export function getUsage(orgId: string): Promise<{ usage: Usage }> {
  return request<{ usage: Usage }>(`/api/v1/organizations/${encodeURIComponent(orgId)}/usage`);
}

// ── Continuous operations snapshot ───────────────────────────────────────────

export interface OpsSnapshot {
  organization_id: string;
  data_state: string;
  generated_at_ms: number;
  monitoring: { status: string; last_observed_at_ms?: number | null; signals_observed: number };
  risk: { status: string; highest_risk_band: string; high_or_critical_findings: number; open_incidents: number };
  alerts: { total: number; open: number; acknowledged: number; by_severity: Record<string, number> };
  policy_drift: { total_observations: number; drifted: number; in_sync: number; baseline_missing: number };
  crypto_posture: CryptoPosture;
  aer_kep_q: {
    status: string;
    runtime_attachment: string;
    domain_id?: string | null;
    active_epoch?: number | null;
    epoch_status?: string | null;
    pending_messages?: number | null;
    exposure_status?: string | null;
  };
  incidents: { total: number; open: number; acknowledged: number; resolved: number };
}

export interface KeyLifecycleView {
  service_id: string;
  ed25519_key_id: string;
  ml_dsa_87_key_id: string;
  issuer_key_fingerprint: string;
  state: string;
}

export interface CryptoPosture {
  status: string;
  key_registry: {
    status: string;
    total: number;
    active: number;
    rotating: number;
    deprecated: number;
    retired: number;
    revoked: number;
    issuers: KeyLifecycleView[];
  };
  receipt_verification: {
    status: string;
    total_receipts: number;
    verified: number;
    pending_verification: number;
    rejected: number;
  };
}

export function getOperations(orgId: string): Promise<OpsSnapshot> {
  return request<OpsSnapshot>(`/api/v1/organizations/${encodeURIComponent(orgId)}/security/operations`);
}

export function getExecutiveReport(orgId: string): Promise<{ report_type: string; source: string; snapshot: OpsSnapshot }> {
  return request<{ report_type: string; source: string; snapshot: OpsSnapshot }>(
    `/api/v1/organizations/${encodeURIComponent(orgId)}/security/executive-report`,
  );
}

export function getCryptoPosture(orgId: string): Promise<CryptoPosture> {
  return request<CryptoPosture>(`/api/v1/organizations/${encodeURIComponent(orgId)}/security/crypto-posture`);
}

// ── Findings / incidents / telemetry ─────────────────────────────────────────

export interface SecurityFinding {
  organization_id: string;
  finding_id: string;
  receipt_id: string;
  severity: string;
  status: string;
  evidence_refs: string[];
  risk_score: number;
  risk_band: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface FindingList {
  organization_id: string;
  items: SecurityFinding[];
  total: number;
  data_state: string;
  next_cursor: string | null;
}

export function listFindings(orgId: string): Promise<FindingList> {
  return request<FindingList>(`/api/v1/organizations/${encodeURIComponent(orgId)}/findings`);
}

export interface FindingInput {
  finding_id: string;
  receipt_id: string;
  severity: string;
  status: string;
  evidence_refs: string[];
  risk_score: number;
  created_at_ms: number;
  updated_at_ms: number;
}

export function ingestFinding(orgId: string, input: FindingInput): Promise<{ finding: SecurityFinding } | SecurityFinding> {
  return request<{ finding: SecurityFinding } | SecurityFinding>(
    `/api/v1/organizations/${encodeURIComponent(orgId)}/findings`,
    { method: 'POST', body: input },
  );
}

export interface SecurityIncident {
  organization_id: string;
  incident_id: string;
  severity: string;
  status: string;
  risk_score: number;
  risk_band: string;
  finding_ids: string[];
  created_at_ms: number;
  updated_at_ms: number;
}

export interface IncidentList {
  organization_id: string;
  items: SecurityIncident[];
  total: number;
  data_state: string;
  next_cursor: string | null;
}

export function listIncidents(orgId: string): Promise<IncidentList> {
  return request<IncidentList>(`/api/v1/organizations/${encodeURIComponent(orgId)}/incidents`);
}

export function transitionIncident(orgId: string, incidentId: string, status: string): Promise<unknown> {
  return request<unknown>(
    `/api/v1/organizations/${encodeURIComponent(orgId)}/incidents`,
    { method: 'POST', body: { incident_id: incidentId, status } },
  );
}

export interface TransactionRecord {
  organization_id: string;
  transaction_id: string;
  tenant_id: string;
  state: string;
  kind: string;
  subject_id: string;
  proposed_action: string;
  policy_id: string;
  policy_version: string;
  correlation_id?: string | null;
  receipt_id?: string | null;
  outcome_code?: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface ReceiptRecord {
  organization_id: string;
  receipt_id: string;
  transaction_id: string;
  tenant_id: string;
  status: string;
  decision: string;
  outcome_code: string;
  policy_id: string;
  policy_version: string;
  ledger_commit_index: number;
  timestamp_ms: number;
  payload_hash: string;
  issuer_key_fingerprint: string;
  verification: string;
}

export interface TransactionList {
  organization_id: string;
  items: TransactionRecord[];
  total: number;
  receipts: ReceiptRecord[];
  data_state: string;
  next_cursor: string | null;
  trust_boundary: string;
  receipt_authentication: string;
}

export function listTransactions(orgId: string): Promise<TransactionList> {
  return request<TransactionList>(`/api/v1/organizations/${encodeURIComponent(orgId)}/transactions`);
}

export function ingestTransaction(orgId: string, input: Omit<TransactionRecord, 'organization_id'>): Promise<unknown> {
  return request<unknown>(`/api/v1/organizations/${encodeURIComponent(orgId)}/transactions`, {
    method: 'POST',
    body: input,
  });
}

export function ingestReceiptTelemetry(orgId: string, input: Omit<ReceiptRecord, 'organization_id'>): Promise<unknown> {
  return request<unknown>(`/api/v1/organizations/${encodeURIComponent(orgId)}/transactions`, {
    method: 'POST',
    body: { kind: 'receipt_telemetry', ...input },
  });
}

export interface AerKepQStatus {
  organization_id: string;
  status: string;
  runtime_attachment: string;
  security_model?: string;
  cipher_suite?: string;
  domain_id?: string | null;
  active_epoch?: number | null;
  epoch_status?: string | null;
  pending_messages?: number | null;
  exposure?: { status: string; quarantine: string };
  note?: string;
}

export function getAerKepQ(orgId: string): Promise<AerKepQStatus> {
  return request<AerKepQStatus>(`/api/v1/organizations/${encodeURIComponent(orgId)}/aer-kep-q/status`);
}

// ── Alerts / policy / remediations / audit ───────────────────────────────────

export interface SecurityAlert {
  organization_id: string;
  alert_id: string;
  signal_id: string;
  source: string;
  severity: string;
  status: string;
  title: string;
  message: string;
  evidence_refs: string[];
  correlation_id: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface AlertList {
  organization_id: string;
  items: SecurityAlert[];
  total: number;
  data_state: string;
}

export function listAlerts(orgId: string): Promise<AlertList> {
  return request<AlertList>(`/api/v1/organizations/${encodeURIComponent(orgId)}/security/alerts`);
}

export interface MonitoringSignalInput {
  signal_id: string;
  source: string;
  severity: string;
  title: string;
  message: string;
  evidence_refs: string[];
  correlation_id?: string | null;
  observed_at_ms: number;
}

export function ingestSignal(orgId: string, input: MonitoringSignalInput): Promise<unknown> {
  return request<unknown>(`/api/v1/organizations/${encodeURIComponent(orgId)}/security/alerts`, {
    method: 'POST',
    body: input,
  });
}

export function transitionAlert(orgId: string, alertId: string, status: string): Promise<unknown> {
  return request<unknown>(
    `/api/v1/organizations/${encodeURIComponent(orgId)}/security/alerts/${encodeURIComponent(alertId)}`,
    { method: 'POST', body: { status } },
  );
}

export interface PolicyDriftRecord {
  organization_id: string;
  drift_id: string;
  policy_id: string;
  baseline_version?: string | null;
  baseline_hash?: string | null;
  observed_version: string;
  observed_hash: string;
  status: string;
  observed_at_ms: number;
  observed_by: string;
}

export interface DriftList {
  organization_id: string;
  items: PolicyDriftRecord[];
  total: number;
  data_state: string;
}

export function listDrift(orgId: string): Promise<DriftList> {
  return request<DriftList>(`/api/v1/organizations/${encodeURIComponent(orgId)}/security/policy-drift`);
}

export function baselinePolicy(orgId: string, policyId: string, policyVersion: string, policy: unknown): Promise<unknown> {
  return request<unknown>(`/api/v1/organizations/${encodeURIComponent(orgId)}/security/policy-baseline`, {
    method: 'POST',
    body: { policy_id: policyId, policy_version: policyVersion, policy },
  });
}

export function observePolicy(orgId: string, policyId: string, policyVersion: string, policy: unknown): Promise<unknown> {
  return request<unknown>(`/api/v1/organizations/${encodeURIComponent(orgId)}/security/policy-observations`, {
    method: 'POST',
    body: { policy_id: policyId, policy_version: policyVersion, policy, observed_at_ms: Date.now() },
  });
}

export interface RemediationAction {
  organization_id: string;
  remediation_id: string;
  action: string;
  finding_id?: string | null;
  incident_id?: string | null;
  status: string;
  rationale: string;
  proposed_by: string;
  approved_by?: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface RemediationList {
  organization_id: string;
  items: RemediationAction[];
  total: number;
  data_state: string;
}

export function listRemediations(orgId: string): Promise<RemediationList> {
  return request<RemediationList>(`/api/v1/organizations/${encodeURIComponent(orgId)}/security/remediations`);
}

export function proposeRemediation(
  orgId: string,
  input: { action: string; finding_id?: string | null; incident_id?: string | null; rationale: string },
): Promise<unknown> {
  return request<unknown>(`/api/v1/organizations/${encodeURIComponent(orgId)}/security/remediations`, {
    method: 'POST',
    body: input,
  });
}

export function transitionRemediation(orgId: string, remediationId: string, status: string): Promise<unknown> {
  return request<unknown>(
    `/api/v1/organizations/${encodeURIComponent(orgId)}/security/remediations/${encodeURIComponent(remediationId)}`,
    { method: 'POST', body: { status } },
  );
}

export interface AuditView {
  organization_id: string;
  source: string;
  alerts: SecurityAlert[];
  policy_drift: PolicyDriftRecord[];
  remediations: RemediationAction[];
}

export function getAudit(orgId: string): Promise<AuditView> {
  return request<AuditView>(`/api/v1/organizations/${encodeURIComponent(orgId)}/security/audit`);
}

// ── Receipt validation (canonical engine) ────────────────────────────────────

export function validateReceipt(orgId: string, contract: unknown, actorWorkloadId: string): Promise<unknown> {
  return request<unknown>(`/api/v1/organizations/${encodeURIComponent(orgId)}/security/validate`, {
    method: 'POST',
    body: { contract, actor_workload_id: actorWorkloadId },
  });
}

// ── Intelligence briefs (operator-reviewed, read-only) ───────────────────────

export interface BriefSummary {
  company: string;
  verdict: 'GO' | 'HOLD' | 'DROP';
  score: number;
  signal_url?: string | null;
  why_now?: string | null;
  buyer_role?: string | null;
}

export function listBriefs(): Promise<BriefSummary[]> {
  return request<BriefSummary[]>('/api/v1/intelligence/briefs');
}

export function getBrief(company: string): Promise<BriefSummary> {
  return request<BriefSummary>(`/api/v1/intelligence/briefs/${encodeURIComponent(company)}`);
}

// ── Sessions (admin visibility) ──────────────────────────────────────────────

export interface SessionEntry {
  id?: string;
  username?: string;
  issued_at_ms?: number;
  expires_in_secs?: number;
  [key: string]: unknown;
}

export function listSessions(): Promise<SessionEntry[]> {
  return request<SessionEntry[]>('/api/v1/sessions');
}

// ── Billing, Plans, Entitlements & Metering ──────────────────────────────────

export interface Plan {
  id: string;
  name: string;
  tier: string;
  product?: string;
  contact_sales: boolean;
  entitlements: string[];
  price_gbp: number | null;
  price_min_gbp: number | null;
  price_max_gbp: number | null;
  billing_model: string;
  billing_type?: string;
  billing_period?: string;
  price_display: string;
}

export function getPlanCatalog(): Promise<Plan[]> {
  return request<Plan[]>('/api/v1/catalog/plans');
}

export function setSubscription(
  orgId: string,
  planId: string,
): Promise<{ subscription: Subscription; requested_plan: string; activation: string }> {
  return request<{ subscription: Subscription; requested_plan: string; activation: string }>(
    `/api/v1/organizations/${encodeURIComponent(orgId)}/subscription`,
    {
      method: 'POST',
      body: { plan_id: planId },
    },
  );
}

export interface VerifiedEntitlementsResponse {
  organization_id: string;
  plan?: Plan;
  subscription_status: string;
  provider?: string;
  entitlements: string[];
  activation: string;
}

export function getVerifiedEntitlements(orgId: string): Promise<VerifiedEntitlementsResponse> {
  return request<VerifiedEntitlementsResponse>(`/api/v1/organizations/${encodeURIComponent(orgId)}/entitlements`);
}

// ── Members & Access Administration ──────────────────────────────────────────

export function setMemberRole(orgId: string, username: string, role: string): Promise<unknown> {
  return request<unknown>(
    `/api/v1/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(username)}/role`,
    {
      method: 'POST',
      body: { role },
    },
  );
}

export interface InvitationRecord {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED';
  created_at_ms: number;
}

export function listInvitations(orgId: string): Promise<{ organization_id: string; invitations: InvitationRecord[] }> {
  return request<{ organization_id: string; invitations: InvitationRecord[] }>(
    `/api/v1/organizations/${encodeURIComponent(orgId)}/invitations`,
  );
}

export function createInvitation(orgId: string, email: string, role: string): Promise<InvitationRecord> {
  return request<InvitationRecord>(`/api/v1/organizations/${encodeURIComponent(orgId)}/invitations`, {
    method: 'POST',
    body: { email, role },
  });
}

export function revokeInvitation(orgId: string, invitationId: string): Promise<unknown> {
  return request<unknown>(
    `/api/v1/organizations/${encodeURIComponent(orgId)}/invitations/${encodeURIComponent(invitationId)}`,
    {
      method: 'POST',
    },
  );
}

export function acceptInvitation(token: string): Promise<unknown> {
  return request<unknown>('/api/v1/invitations/accept', {
    method: 'POST',
    body: { token },
  });
}

// ── Passports (Continuous Assurance & Gateways) ──────────────────────────────

export interface PassportRecord {
  passport_id: string;
  organization_id: string;
  target_resource: string;
  issued_at_ms: number;
  expires_at_ms: number;
  state: string;
  evidence_hash?: string;
  decision_ref?: string;
}

export function getPassport(orgId: string, passportId: string): Promise<PassportRecord> {
  return request<PassportRecord>(
    `/api/v1/organizations/${encodeURIComponent(orgId)}/passports/${encodeURIComponent(passportId)}`,
  );
}

export function createPassport(orgId: string, passport: unknown): Promise<PassportRecord> {
  return request<PassportRecord>(`/api/v1/organizations/${encodeURIComponent(orgId)}/passports`, {
    method: 'POST',
    body: passport,
  });
}

export function updatePassportState(orgId: string, passportId: string, state: string): Promise<PassportRecord> {
  return request<PassportRecord>(
    `/api/v1/organizations/${encodeURIComponent(orgId)}/passports/${encodeURIComponent(passportId)}`,
    {
      method: 'PATCH',
      body: { state },
    },
  );
}

// ── Developer & Ingress API Keys ─────────────────────────────────────────────

export interface ApiKeyItem {
  id: string;
  name: string;
  created_at: number;
  expires_at: number | null;
  revoked: boolean;
  last_used_at: number | null;
  created_by: string;
}

export interface CreateApiKeyResult {
  id: string;
  name: string;
  created_at: number;
  expires_at: number | null;
  secret: string;
}

export function listApiKeys(): Promise<ApiKeyItem[]> {
  return request<ApiKeyItem[]>('/api/v1/admin/api-keys');
}

export function createApiKey(name: string, expiresInDays?: number): Promise<CreateApiKeyResult> {
  return request<CreateApiKeyResult>('/api/v1/admin/api-keys', {
    method: 'POST',
    body: { name, expires_in_days: expiresInDays },
  });
}

export function revokeApiKey(id: string): Promise<ApiKeyItem> {
  return request<ApiKeyItem>(`/api/v1/admin/api-keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ── Operator Profile & Security ──────────────────────────────────────────────

export interface OperatorProfile {
  username: string;
  display_name: string;
  email: string;
  role: string;
  updated_at_ms?: number;
}

export function getOperatorProfile(): Promise<OperatorProfile> {
  return request<OperatorProfile>('/api/v1/admin/profile');
}

export function updateOperatorProfile(data: { display_name?: string; email?: string }): Promise<OperatorProfile> {
  return request<OperatorProfile>('/api/v1/admin/profile', {
    method: 'PUT',
    body: data,
  });
}

export function changePassword(data: {
  current_password: string;
  new_password: string;
  confirm_password: string;
}): Promise<{ status: string }> {
  return request<{ status: string }>('/api/v1/admin/password', {
    method: 'POST',
    body: data,
  });
}

// ── Usage & Metering Recording ───────────────────────────────────────────────

export function recordUsage(
  orgId: string,
  transactions: number,
  bytesProcessed: number,
): Promise<{ usage: UsageSummary }> {
  return request<{ usage: UsageSummary }>(`/api/v1/organizations/${encodeURIComponent(orgId)}/usage/record`, {
    method: 'POST',
    body: { transactions, bytes_processed: bytesProcessed },
  });
}

// ── Webhooks & Event Subscriptions ──────────────────────────────────────────

export interface WebhookEndpoint {
  id: string;
  organization_id: string;
  url: string;
  description: string;
  secret: string;
  events: string[];
  status: string;
  created_at_ms: number;
  last_delivery_ms: number | null;
  success_rate: number;
}

export interface WebhookDeliveryLog {
  id: string;
  organization_id: string;
  webhook_id: string;
  event: string;
  status_code: number;
  latency_ms: number;
  timestamp_ms: number;
  payload_summary: string;
  success: boolean;
  error?: string;
}

export function listWebhooks(orgId: string): Promise<{ organization_id: string; webhooks: WebhookEndpoint[] }> {
  return request<{ organization_id: string; webhooks: WebhookEndpoint[] }>(
    `/api/v1/organizations/${encodeURIComponent(orgId)}/webhooks`,
  );
}

export function createWebhook(
  orgId: string,
  input: { url: string; description?: string; events?: string[]; secret?: string },
): Promise<WebhookEndpoint> {
  return request<WebhookEndpoint>(`/api/v1/organizations/${encodeURIComponent(orgId)}/webhooks`, {
    method: 'POST',
    body: input,
  });
}

export function deleteWebhook(orgId: string, webhookId: string): Promise<void> {
  return request<void>(
    `/api/v1/organizations/${encodeURIComponent(orgId)}/webhooks/${encodeURIComponent(webhookId)}`,
    {
      method: 'DELETE',
    },
  );
}

export function testWebhook(
  orgId: string,
  webhookId: string,
): Promise<{
  delivered: boolean;
  status_code: number;
  latency_ms: number;
  success: boolean;
  error?: string;
  timestamp_ms: number;
}> {
  return request<{
    delivered: boolean;
    status_code: number;
    latency_ms: number;
    success: boolean;
    error?: string;
    timestamp_ms: number;
  }>(`/api/v1/organizations/${encodeURIComponent(orgId)}/webhooks/${encodeURIComponent(webhookId)}/test`, {
    method: 'POST',
  });
}

export function listWebhookDeliveries(
  orgId: string,
): Promise<{ organization_id: string; deliveries: WebhookDeliveryLog[] }> {
  return request<{ organization_id: string; deliveries: WebhookDeliveryLog[] }>(
    `/api/v1/organizations/${encodeURIComponent(orgId)}/webhooks/deliveries`,
  );
}

// ── Organization Email Notifications ─────────────────────────────────────────

export interface OrganizationEmailConfig {
  organization_id: string;
  recipients: string[];
  enabled: boolean;
  notify_on_critical_finding: boolean;
  notify_on_replay_attack: boolean;
  notify_on_tamper: boolean;
  smtp_host?: string;
  smtp_port?: number;
  from_address: string;
  relay_mode: string;
  updated_at_ms: number;
}

export interface EmailNotificationLog {
  id: string;
  organization_id: string;
  event_type: string;
  recipients: string[];
  subject: string;
  body_snippet: string;
  delivered: boolean;
  timestamp_ms: number;
  proof_hash: string;
}

export function getEmailNotificationConfig(orgId: string): Promise<{
  config: OrganizationEmailConfig;
  recent_dispatches: EmailNotificationLog[];
  active_recipients_count: number;
}> {
  return request(`/api/v1/organizations/${encodeURIComponent(orgId)}/notifications/email`);
}

export function updateEmailNotificationConfig(
  orgId: string,
  input: Partial<OrganizationEmailConfig>,
): Promise<{ status: string; config: OrganizationEmailConfig }> {
  return request(`/api/v1/organizations/${encodeURIComponent(orgId)}/notifications/email`, {
    method: 'POST',
    body: input,
  });
}

export function sendTestEmailNotification(
  orgId: string,
  recipient?: string,
): Promise<{
  status: string;
  notification_id: string;
  recipient: string;
  proof_blake3: string;
  timestamp_ms: number;
}> {
  return request(`/api/v1/organizations/${encodeURIComponent(orgId)}/notifications/email/test`, {
    method: 'POST',
    body: { recipient },
  });
}

// ── Cryptographic Licensing & Direct Subscriptions ───────────────────────────

export interface MintLicenseParams {
  tenant_id: string;
  valid_days: number;
  max_nodes: number;
  package_tier?: string;
}

export interface MintLicenseResult {
  tenant_id: string;
  valid_until: number;
  max_nodes: number;
  signature: string;
  _package_tier: string;
  _minted_by: string;
  _issued_at_epoch: number;
  _verifying_key: string;
}

export function mintLicense(params: MintLicenseParams): Promise<MintLicenseResult> {
  return request<MintLicenseResult>('/api/v1/billing/licenses/mint', {
    method: 'POST',
    body: params,
  });
}

export interface InstallLicenseParams {
  tenant_id: string;
  valid_until: number;
  max_nodes: number;
  signature: string;
}

export interface InstallLicenseResult {
  installed: boolean;
  tenant_id: string;
  valid_until: number;
  max_nodes: number;
}

export function installLicense(params: InstallLicenseParams): Promise<InstallLicenseResult> {
  return request<InstallLicenseResult>('/api/v1/billing/licenses/install', {
    method: 'POST',
    body: params,
  });
}

export interface RenewLicenseParams {
  organization_id: string;
  period_days: number;
  notes?: string;
}

export interface RenewLicenseResult {
  submitted: boolean;
  reference_id: string;
  period_days: number;
}

export function renewLicense(params: RenewLicenseParams): Promise<RenewLicenseResult> {
  return request<RenewLicenseResult>('/api/v1/billing/licenses/renew', {
    method: 'POST',
    body: params,
  });
}

export interface ActivateSubscriptionParams {
  organization_id: string;
  plan_id: string;
  idempotency_key?: string;
  provider?: string;
}

export interface ActivateSubscriptionResult {
  activated: boolean;
  subscription: {
    organization_id: string;
    plan_id: string;
    status: string;
    provider: string;
  };
  verified?: unknown;
}

export function activateSubscription(params: ActivateSubscriptionParams): Promise<ActivateSubscriptionResult> {
  return request<ActivateSubscriptionResult>('/api/v1/billing/subscriptions/activate', {
    method: 'POST',
    body: params,
  });
}



