/**
 * Read-side API port for the dashboard. Default implementation wraps the
 * M5 `ApiClient` (the ONLY HMAC-signing implementation in the repo,
 * ADR-0011) with the dashboard's read role. Tests inject a fake.
 */

import { ApiClient, ApiClientError } from '@zkpe/api';
import type {
  AuditEntry,
  CircuitSummary,
  ProofStatus,
  RegistryInfo,
} from '../shared/types.js';

export interface DashboardApiPort {
  registryInfo(): Promise<RegistryInfo>;
  listCircuits(): Promise<{ circuits: CircuitSummary[] }>;
  proofStatus(circuitId: string, publicInputHash: string): Promise<ProofStatus>;
  auditLogs(limit: number): Promise<{ entries: AuditEntry[] }>;
}

export class ApiPortError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiPortError';
  }
}

export class ApiClientDashboardPort implements DashboardApiPort {
  private readonly client: ApiClient;

  constructor(cfg: { baseUrl: string; clientId: string; secret: string }) {
    this.client = new ApiClient(cfg);
  }

  async registryInfo(): Promise<RegistryInfo> {
    return this.request(async () => this.client.registryInfo()) as Promise<RegistryInfo>;
  }

  async listCircuits(): Promise<{ circuits: CircuitSummary[] }> {
    return this.request(async () => this.client.listCircuits()) as Promise<{ circuits: CircuitSummary[] }>;
  }

  async proofStatus(circuitId: string, publicInputHash: string): Promise<ProofStatus> {
    return this.request(async () => this.client.proofStatus(circuitId, publicInputHash)) as Promise<ProofStatus>;
  }

  async auditLogs(limit: number): Promise<{ entries: AuditEntry[] }> {
    return this.request(async () => this.client.auditLogs(limit)) as Promise<{ entries: AuditEntry[] }>;
  }

  private async request(fn: () => Promise<unknown>): Promise<unknown> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiClientError) {
        throw new ApiPortError(err.status, err.problem.code ?? 'api_error', err.message);
      }
      throw new ApiPortError(0, 'api_unreachable', err instanceof Error ? err.message : String(err));
    }
  }
}
