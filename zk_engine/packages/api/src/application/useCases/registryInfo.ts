/**
 * Registry overview: schema version, pause state, proof count, and per-circuit
 * chain config. Passthrough of the registry port (no local crypto).
 */

import { randomUUID } from 'node:crypto';
import type { ExecutionContext } from '../../domain/entities.js';
import type { AuditSinkPort, MetricsSinkPort, RegistryReadPort, TracerPort } from '../../domain/ports.js';

export interface RegistryInfoDeps {
  registry: RegistryReadPort;
  audit: AuditSinkPort;
  metrics: MetricsSinkPort;
  tracer: TracerPort;
}

export class RegistryInfoUseCase {
  constructor(private readonly deps: RegistryInfoDeps) {}

  async info(circuitIds: string[], ctx: ExecutionContext) {
    const span = this.deps.tracer.startSpan('api.registry.info');
    let info;
    try {
      info = await this.deps.registry.registryInfo(circuitIds);
    } catch (err) {
      span.fail('registry.info failed');
      span.end();
      throw err;
    }
    span.end();
    this.deps.metrics.inc('registry_reads_total', 1, { op: 'registryInfo' });
    await this.deps.audit.append({
      id: `aud_${randomUUID().slice(0, 8)}`,
      at: new Date().toISOString(),
      actor: ctx.actor,
      tenantId: ctx.tenantId,
      action: 'registry.read',
      resource: '/v1/registry',
      outcome: 'ok',
      detail: { schemaVersion: info.schemaVersion, totalProofs: info.totalProofs },
      ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
      requestId: ctx.requestId,
    });
    return info;
  }
}