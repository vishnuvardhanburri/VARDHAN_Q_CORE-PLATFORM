export interface IntelligenceIdentity { engine_id: string; engine_version: string; run_id: string; }
export interface OrganizationIdentity { organization_id: string; canonical_domain: string; }
export interface ResourceIdentity { canonical_url: string; surface_type: string; entry_point_id: string; }
export interface EvidenceRef { evidence_id: string; public_url: string; temporal_status: string; is_context_artifact: boolean; evidence_origin: string; content_hash: string; }
export interface ProvenanceChain { expectation_id: string; observation_ids: string[]; differential_id: string; hypothesis_id: string; verification_contract_id: string; }
export interface AuthorizationContext { requires_authorized_assessment: boolean; authorized_by?: string; authorization_scope?: string; }
export interface VerifiedFindingContract {
  schema_version: string; finding_id: string; intelligence: IntelligenceIdentity; organization: OrganizationIdentity;
  affected_resource: ResourceIdentity; technical_area: string; technical_mechanism: string; expected_behavior: string;
  observed_behavior: string; differential_state: string; materiality: string; evidence_refs: EvidenceRef[];
  provenance_chain: ProvenanceChain; contradictory_evidence_ids: string[]; uncertainty: string[]; benign_explanation: string;
  authorization_context: AuthorizationContext; decision_candidate: string; policy_reference: string; created_at: string;
  evidence_earliest_retrieved_at: string; evidence_latest_retrieved_at: string;
}
export interface QCoreValidationRequest { contract: VerifiedFindingContract; actor_workload_id?: string; }
export interface EvidenceCommitment { evidence_id: string; content_hash: string; category: string; }
export interface DualSignature { ed25519_sig: string; ed25519_key_id: string; ml_dsa_87_sig: string; ml_dsa_87_key_id: string; }
export interface VardhanSealedReceipt {
  receipt_id: string; schema_version: string; transaction_id: string; status: string; tenant_id: string; subject_id: string;
  actor_identity: string; proposed_action: string; policy_id: string; policy_version: string; state_hash_at_decision?: string;
  evidence_commitments: EvidenceCommitment[]; authority_reference: string; decision: string; outcome_code: string;
  timestamp_ms: number; ledger_commit_index: number; parent_receipt_id?: string; correlation_id?: string;
  payload_hash: string; issuer_key_fingerprint: string; signatures: DualSignature;
}
export interface Organization { id: string; name: string; owner: string; created_at_ms: number; }
export interface Member { username: string; role: string; }
export interface Invitation { id: string; organization_id: string; email: string; role: string; expires_at_ms: number; accepted_at_ms?: number; revoked: boolean; }
export interface Transaction { transaction_id: string; state: string; kind: string; receipt_id?: string; outcome_code?: string; }
export interface ApiError { error?: string; code?: string; message?: string; }

export class QCoreClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  constructor(baseUrl = "http://localhost:8080", apiKey?: string) { this.baseUrl = baseUrl.replace(/\/$/, ""); this.apiKey = apiKey; }
  private async request<T>(path: string, init: RequestInit = {}, idempotencyKey?: string): Promise<T> {
    const headers = new Headers(init.headers); headers.set("Content-Type", "application/json");
    if (this.apiKey) headers.set("Authorization", `Bearer ${this.apiKey}`);
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
    const response = await fetch(`${this.baseUrl}${path}`, {...init, headers});
    const text = await response.text(); let body: unknown = {}; try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
    if (!response.ok) throw Object.assign(new Error((body as ApiError).error || (body as ApiError).message || `Q-Core API Error: ${response.status}`), { status: response.status, body });
    return body as T;
  }
  sealTransaction(request: QCoreValidationRequest, idempotencyKey?: string) { return this.request<{status:string;receipt:VardhanSealedReceipt;transport?:unknown}>("/api/v1/seal", {method:"POST",body:JSON.stringify(request)}, idempotencyKey); }
  me() { return this.request<{username:string;authenticated:boolean;role:string}>("/api/v1/me"); }
  organizations() { return this.request<{organizations:Organization[]}>("/api/v1/organizations"); }
  createOrganization(name: string, idempotencyKey?: string) { return this.request<{organization:Organization}>("/api/v1/organizations", {method:"POST",body:JSON.stringify({name})}, idempotencyKey); }
  members(orgId: string) { return this.request<{organization_id:string;members:Member[]}>(`/api/v1/organizations/${encodeURIComponent(orgId)}/members`); }
  setMemberRole(orgId: string, username: string, role: string, idempotencyKey?: string) { return this.request<{status:string;username:string;role:string}>(`/api/v1/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(username)}/role`, {method:"POST",body:JSON.stringify({role})}, idempotencyKey); }
  invitations(orgId: string) { return this.request<{invitations:Invitation[]}>(`/api/v1/organizations/${encodeURIComponent(orgId)}/invitations`); }
  createInvitation(orgId: string, email: string, role = "viewer", idempotencyKey?: string) { return this.request<{invitation_id:string;token:string}>(`/api/v1/organizations/${encodeURIComponent(orgId)}/invitations`, {method:"POST",body:JSON.stringify({email,role})}, idempotencyKey); }
  securityPosture(orgId: string) { return this.request<Record<string,unknown>>(`/api/v1/organizations/${encodeURIComponent(orgId)}/security/posture`); }
  findings(orgId: string) { return this.request<Record<string,unknown>>(`/api/v1/organizations/${encodeURIComponent(orgId)}/findings`); }
  incidents(orgId: string) { return this.request<Record<string,unknown>>(`/api/v1/organizations/${encodeURIComponent(orgId)}/incidents`); }
  transactions(orgId: string) { return this.request<Record<string,unknown>>(`/api/v1/organizations/${encodeURIComponent(orgId)}/transactions`); }
  aerKepQStatus(orgId: string) { return this.request<Record<string,unknown>>(`/api/v1/organizations/${encodeURIComponent(orgId)}/aer-kep-q/status`); }
  async verifyWebhook(rawBody: string, signatureHex: string, secret: string, timestamp: string, nonce: string): Promise<boolean> {
    const encoder = new TextEncoder(); const data = encoder.encode(`${timestamp}.${nonce}.${rawBody}`); const key = await crypto.subtle.importKey("raw", encoder.encode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["verify"]);
    const sig = Uint8Array.from(signatureHex.match(/.{1,2}/g)?.map(x=>parseInt(x,16)) ?? []); return crypto.subtle.verify("HMAC", key, sig, data);
  }
}
