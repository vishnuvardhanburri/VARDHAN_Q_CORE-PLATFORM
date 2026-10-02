/**
 * Audit log read (audit role). Passthrough of the audit sink.
 */

import { randomUUID } from 'node:crypto';
import type { AuditAction, ExecutionContext } from '../../domain/entities.js';
import type { AuditSinkPort } from '../../domain/ports.js';

export interface AuditListDeps {
  audit: AuditSinkPort;
}

export class AuditListUseCase {
  constructor(private readonly deps: AuditListDeps) {}

  async list(limit: number, action: AuditAction | undefined, ctx: ExecutionContext) {
    const events = await this.deps.audit.recent(limit, action);
    await this.deps.audit.append({
      id: `aud_${randomUUID().slice(0, 8)}`,
      at: new Date().toISOString(),
      actor: ctx.actor,
      tenantId: ctx.tenantId,
      action: 'audit.read',
      resource: '/v1/audit',
      outcome: 'ok',
      detail: { count: events.length },
      ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
      requestId: ctx.requestId,
    });
    return { entries: events };
  }
}