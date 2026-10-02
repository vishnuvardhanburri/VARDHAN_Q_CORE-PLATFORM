/**
 * On-chain proof status read (ADR-0005 category (b)). CircuitId and the
 * public-input anchor are canonicalized by proof-format — never here.
 */

import { randomUUID } from 'node:crypto';
import type { ExecutionContext, ProofStatusEntry } from '../../domain/entities.js';
import { DomainError } from '../../domain/errors.js';
import type { AuditSinkPort, MetricsSinkPort, RegistryReadPort, TracerPort } from '../../domain/ports.js';

export interface StatusUseCaseDeps {
  registry: RegistryReadPort;
  audit: AuditSinkPort;
  metrics: MetricsSinkPort;
  tracer: TracerPort;
}

export class ProofStatusUseCase {
  constructor(private readonly deps: StatusUseCaseDeps) {}

  async status(circuitId: string, anchorHex: string, ctx: ExecutionContext): Promise<ProofStatusEntry & { circuitId: string }> {
    const span = this.deps.tracer.startSpan('api.proof.status', { circuitId });
    let entry: ProofStatusEntry;
    try {
      entry = await this.deps.registry.getProofStatus(circuitId, anchorHex);
    } catch (err) {
      span.fail('registry.status failed');
      span.end();
      throw new DomainError('UPSTREAM-REGISTRY', { detail: `getProofStatus failed: ${err instanceof Error ? err.message : String(err)}`, cause: err });
    }
    span.end();
    this.deps.metrics.inc('registry_reads_total', 1, { op: 'getProofStatus' });
    await this.deps.audit.append({
      id: `aud_${randomUUID().slice(0, 8)}`,
      at: new Date().toISOString(),
      actor: ctx.actor,
      tenantId: ctx.tenantId,
      action: 'proof.status',
      resource: '/v1/proofs/status',
      outcome: 'ok',
      detail: { circuitId, status: entry.status },
      ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
      requestId: ctx.requestId,
    });
    return { ...entry, circuitId };
  }
}