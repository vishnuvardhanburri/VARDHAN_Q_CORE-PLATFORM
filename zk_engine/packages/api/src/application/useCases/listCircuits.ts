/**
 * Circuit catalog reads — a thin projection over the engine catalog,
 * enriched with on-chain config (verifier/vkHash/active) when a registry
 * read port is configured. No hashing here.
 */

import { randomUUID } from 'node:crypto';
import type { ChainCircuitConfig, CircuitInfo, ExecutionContext } from '../../domain/entities.js';
import type { AuditSinkPort, EnginePort, RegistryReadPort } from '../../domain/ports.js';

export interface ListCircuitsDeps {
  engine: EnginePort;
  registry?: RegistryReadPort | null;
  audit: AuditSinkPort;
}

export interface CircuitListItem extends CircuitInfo {
  registry?: ChainCircuitConfig | null;
}

export class ListCircuitsUseCase {
  constructor(private readonly deps: ListCircuitsDeps) {}

  async list(ctx: ExecutionContext): Promise<{ circuits: CircuitListItem[] }> {
    const catalog = await this.deps.engine.listCircuits();
    const circuits: CircuitListItem[] = [];
    for (const c of catalog) {
      const item: CircuitListItem = { ...c };
      if (this.deps.registry) {
        try {
          item.registry = await this.deps.registry.getCircuit(c.circuitId);
        } catch {
          item.registry = null;
        }
      }
      circuits.push(item);
    }
    await this.deps.audit.append({
      id: `aud_${randomUUID().slice(0, 8)}`,
      at: new Date().toISOString(),
      actor: ctx.actor,
      tenantId: ctx.tenantId,
      action: 'circuit.list',
      resource: '/v1/circuits',
      outcome: 'ok',
      detail: { count: circuits.length },
      ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
      requestId: ctx.requestId,
    });
    return { circuits };
  }
}