/**
 * Audit sink (§11): append-only ring (bounded) + optional JSON-lines file.
 * Entries are immutable scalars — never proofs, inputs, or secrets.
 */

import { appendFileSync } from 'node:fs';
import type { AuditAction, AuditEvent } from '../../domain/entities.js';
import type { AuditSinkPort } from '../../domain/ports.js';

const RING_CAP = 1024;

export class AuditLog implements AuditSinkPort {
  private readonly ring: AuditEvent[] = [];
  private readonly filePath: string | null;
  private readonly cap: number;

  constructor(opts: { filePath?: string; cap?: number } = {}) {
    this.filePath = opts.filePath?.length ? opts.filePath : null;
    this.cap = opts.cap ?? RING_CAP;
  }

  async append(event: AuditEvent): Promise<void> {
    this.ring.push(event);
    if (this.ring.length > this.cap) this.ring.shift();
    if (this.filePath) {
      try {
        const safeEvent = {
          ...event,
          ...(event.ip ? { ip: event.ip.replace(/[\r\n]/g, '') } : {}),
          ...(event.action ? { action: event.action.replace(/[\r\n]/g, '') } : {})
        };
        const line = JSON.stringify(safeEvent);
        appendFileSync(this.filePath, line + '\n', 'utf8');
      } catch (err) {
        throw new Error(`audit file write failed: ${(err as Error).message}`);
      }
    }
  }

  async recent(limit: number, action?: AuditAction, tenantId?: string): Promise<AuditEvent[]> {
    let list = action ? this.ring.filter((e) => e.action === action) : this.ring;
    // Tenant isolation: when tenantId is provided, filter to that tenant's events only.
    if (tenantId !== undefined) list = list.filter((e) => e.tenantId === tenantId);
    return list.slice(-Math.max(1, Math.min(limit, 1000))).reverse();
  }

  count(): number {
    return this.ring.length;
  }
}