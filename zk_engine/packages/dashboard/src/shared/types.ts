/**
 * Dashboard DTOs — shared between the Fastify BFF and the React client.
 * These mirror the API's public DTOs (read-only surface) plus the
 * circuit-lib manifest facts the dashboard renders. No private data types
 * exist here by construction (docs/20 §1).
 */

export type ProofStatusValue = 'unproved' | 'proved' | 'revoked';

export interface RegistryCircuitConfig {
  verifier: string;
  vkHash: string;
  active: boolean;
}

export interface RegistryInfo {
  proxy: string;
  schemaVersion: string;
  totalProofs: string;
  paused: boolean;
  circuits: Record<string, RegistryCircuitConfig>;
}

export interface CircuitSummary {
  circuitId: string;
  version: string;
  label: string;
  nPublic: number;
  artifactsReady: boolean;
  registry: RegistryCircuitConfig | null;
}

export interface CircuitArtifactFacts {
  r1cs: string;
  wasm: string;
  zkey: string;
  vkSha256: string;
}

export interface CircuitDetail extends CircuitSummary {
  manifest: {
    vkHash: string;
    artifactBundleHash: string;
    manifestHash: string;
    artifacts: CircuitArtifactFacts;
  } | null;
  certified: boolean;
  files: { r1cs: boolean; wasm: boolean; zkey: boolean; vkey: boolean } | null;
}

export interface ProofStatus {
  circuitId: string;
  status: ProofStatusValue;
  provedAt: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  resource: string;
  outcome: string;
  detail?: Record<string, string | number | boolean>;
  ip?: string;
  requestId: string;
}

export interface GateCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface GateReportSummary {
  file: string;
  verified: boolean;
  circuitId: string | null;
  vkHash: string | null;
  artifactHash: string | null;
  publicInputHash: string | null;
  keyId: string | null;
  reasonCount: number;
  failedChecks: string[];
}

export interface GateReportDetail extends GateReportSummary {
  checks: GateCheck[];
  reasons: string[];
  onChain: Record<string, unknown> | null;
}

export interface GateOverview {
  count: number;
  latest: GateReportSummary | null;
  reports: GateReportSummary[];
  byCircuit: Record<string, { reports: number; latestVerified: boolean; latestArtifactHash: string | null }>;
}

export interface ApiErrorDetail {
  code: string;
  detail: string;
}
