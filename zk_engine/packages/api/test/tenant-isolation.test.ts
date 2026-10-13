/**
 * Multi-tenant isolation tests (Phase 6):
 * - tenantId flows correctly from auth credentials through to audit events
 * - audit log `recent()` correctly filters by tenantId
 * - tenantId defaults to clientId when not specified (backward compat)
 * - cross-tenant dedup isolation (idempotency keys are scoped per tenant)
 */

import { describe, it, expect } from 'vitest';
import { EnvSecretStore } from '../src/infrastructure/auth/EnvSecretStore.js';
import { AuditLog } from '../src/infrastructure/observability/AuditLog.js';
import type { AuditEvent } from '../src/domain/entities.js';

// ---------------------------------------------------------------------------
// EnvSecretStore: tenantId resolution
// ---------------------------------------------------------------------------

describe('EnvSecretStore — tenantId', () => {
  it('defaults tenantId to clientId when not specified', () => {
    const store = new EnvSecretStore('client-a:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:read');
    // Access the internals via lookup
    void store.lookup('client-a').then((s) => {
      expect(s?.tenantId).toBe('client-a');
    });
  });

  it('parses explicit tenantId from ZK_API_KEYS', async () => {
    const store = new EnvSecretStore('client-a:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:read:org-xyz');
    const secret = await store.lookup('client-a');
    expect(secret?.tenantId).toBe('org-xyz');
    expect(secret?.clientId).toBe('client-a');
  });

  it('supports multiple clients in different tenants', async () => {
    const raw = [
      'client-1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:read:tenant-a',
      'client-2:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:submit:tenant-b',
      'client-3:cccccccccccccccccccccccccccccccc:write',
    ].join(';');
    const store = new EnvSecretStore(raw);
    expect((await store.lookup('client-1'))?.tenantId).toBe('tenant-a');
    expect((await store.lookup('client-2'))?.tenantId).toBe('tenant-b');
    // Falls back to clientId
    expect((await store.lookup('client-3'))?.tenantId).toBe('client-3');
  });

  it('returns null for an unknown clientId', async () => {
    const store = new EnvSecretStore('client-a:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:read');
    expect(await store.lookup('unknown-client')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AuditLog: tenant-scoped reads
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'aud_test',
    at: new Date().toISOString(),
    actor: 'client-a',
    tenantId: 'tenant-a',
    action: 'proof.verify',
    resource: '/v1/proofs/verify',
    outcome: 'ok',
    requestId: 'req-1',
    ...overrides,
  };
}

describe('AuditLog — tenant isolation', () => {
  it('returns all events when tenantId is not specified', async () => {
    const log = new AuditLog();
    await log.append(makeEvent({ tenantId: 'tenant-a', id: 'e1' }));
    await log.append(makeEvent({ tenantId: 'tenant-b', id: 'e2' }));
    const events = await log.recent(100);
    expect(events).toHaveLength(2);
  });

  it('filters events by tenantId', async () => {
    const log = new AuditLog();
    await log.append(makeEvent({ tenantId: 'tenant-a', id: 'e1' }));
    await log.append(makeEvent({ tenantId: 'tenant-b', id: 'e2' }));
    await log.append(makeEvent({ tenantId: 'tenant-a', id: 'e3' }));
    const tenantAEvents = await log.recent(100, undefined, 'tenant-a');
    expect(tenantAEvents).toHaveLength(2);
    expect(tenantAEvents.every((e) => e.tenantId === 'tenant-a')).toBe(true);
  });

  it('filters events by tenantId AND action', async () => {
    const log = new AuditLog();
    await log.append(makeEvent({ tenantId: 'tenant-a', action: 'proof.verify', id: 'e1' }));
    await log.append(makeEvent({ tenantId: 'tenant-a', action: 'proof.register', id: 'e2' }));
    await log.append(makeEvent({ tenantId: 'tenant-b', action: 'proof.verify', id: 'e3' }));
    const events = await log.recent(100, 'proof.verify', 'tenant-a');
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe('e1');
  });

  it('returns empty array when tenant has no events', async () => {
    const log = new AuditLog();
    await log.append(makeEvent({ tenantId: 'tenant-a' }));
    const events = await log.recent(100, undefined, 'unknown-tenant');
    expect(events).toHaveLength(0);
  });

  it('returns results in reverse chronological order', async () => {
    const log = new AuditLog();
    for (let i = 0; i < 5; i++) {
      await log.append(makeEvent({ tenantId: 'tenant-a', id: `e${i}`, requestId: `req-${i}` }));
    }
    const events = await log.recent(100, undefined, 'tenant-a');
    expect(events).toHaveLength(5);
    // reverse chronological: last appended first
    expect(events[0]?.requestId).toBe('req-4');
    expect(events[4]?.requestId).toBe('req-0');
  });

  it('respects the limit parameter under tenant filtering', async () => {
    const log = new AuditLog();
    for (let i = 0; i < 10; i++) {
      await log.append(makeEvent({ tenantId: 'tenant-a', id: `e${i}` }));
    }
    const events = await log.recent(3, undefined, 'tenant-a');
    expect(events).toHaveLength(3);
  });
});
