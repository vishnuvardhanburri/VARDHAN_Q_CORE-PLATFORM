/**
 * Domain entities (Clean Architecture boundary — zero runtime dependencies).
 *
 * Proof shapes are type-only imports from @zkpe/proof-format: the canonical
 * types hub. The API never re-implements any crypto or serialization — it
 * moves these values between the engine and the registry contract.
 *
 * Multi-tenancy: tenantId is always derived from the authenticated identity
 * (EnvSecretStore → Authenticator → ApiPrincipal) and never from
 * client-supplied request headers. It defaults to clientId, so single-tenant
 * deployments require no configuration changes.
 */

import type { Groth16Proof } from '@zkpe/proof-format';

/** A circuitId as known to the engine and chain (e.g. "poseidon-preimage"). */
export type CircuitId = string;

/** Wire model for proof submissions (ADR-0005: public inputs only). */
export interface ProofSubmission {
  circuitId: CircuitId;
  proof: Groth16Proof;
  /** Canonical decimal field strings, in circuit order. */
  publicInputs: string[];
}

/** Outcome of engine-side cryptographic verification (T4 gate). */
export interface VerifyOutcome {
  valid: boolean;
  circuitId: CircuitId;
  /** Machine-readable reason for `valid === false` (no proof data). */
  detail?: string;
}

/** Registry ProofStatus mapping: enum { None=0, Proved=1, Revoked=2 }. */
export type ProofStatusValue = 'unproved' | 'proved' | 'revoked';

export interface ProofStatusEntry {
  status: ProofStatusValue;
  /** Block timestamp (decimal string) of first registration, "0" when none. */
  provedAt: string;
}

export interface CircuitInfo {
  circuitId: CircuitId;
  version: string;
  label: string;
  nPublic: number;
  artifactsReady: boolean;
}

export interface ChainCircuitConfig {
  verifier: string;
  vkHash: string;
  active: boolean;
}

export interface RegistryInfo {
  proxy: string;
  schemaVersion: string;
  totalProofs: string;
  paused: boolean;
  circuits: Record<CircuitId, ChainCircuitConfig>;
}

export interface RegisterResult {
  circuitId: CircuitId;
  verified: boolean;
  /** proof-format canonical anchor (bytes32 hex). */
  publicInputHash: string;
  txHash: string;
}

export type Role = 'read' | 'submit' | 'write' | 'audit';

export interface ApiPrincipal {
  clientId: string;
  /** Tenant the client belongs to. Defaults to clientId when not specified. */
  tenantId: string;
  roles: Set<Role>;
}

export interface ClientSecret {
  clientId: string;
  secret: string;
  roles: Set<Role>;
  /** Tenant this credential belongs to. Defaults to clientId when not specified. */
  tenantId: string;
}

export type AuditAction =
  | 'auth.failed'
  | 'auth.replayed'
  | 'proof.verify'
  | 'proof.register'
  | 'proof.status'
  | 'registry.read'
  | 'circuit.list'
  | 'circuit.detail'
  | 'audit.read'
  | 'ratelimit.enforced';

export type AuditOutcome = 'granted' | 'denied' | 'failed' | 'replayed' | 'ok';

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  /** Tenant that generated this audit event. Always server-derived. */
  tenantId: string;
  action: AuditAction;
  resource: string;
  outcome: AuditOutcome;
  /** Plain scalar detail only — never secrets, inputs, or proofs. */
  detail?: Record<string, string | number | boolean>;
  ip?: string;
  requestId: string;
}

export interface IdempotencyRecord {
  payloadHash: string;
  result: unknown;
  at: string;
}

/** Correlation / request-scoped context handed to use cases. */
export interface ExecutionContext {
  requestId: string;
  actor: string;
  /** Tenant context derived from the authenticated principal. Always server-derived. */
  tenantId: string;
  ip?: string;
}