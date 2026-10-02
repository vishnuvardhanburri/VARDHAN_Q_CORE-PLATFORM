/**
 * Verify a proof locally through the engine (T4 gate). No chain involvement.
 * The anchor is computed ONCE, by proof-format — no hashing here.
 */

import { randomUUID } from 'node:crypto';
import { publicInputHash } from '@zkpe/proof-format';
import type { ExecutionContext, ProofSubmission } from '../../domain/entities.js';
import { DomainError } from '../../domain/errors.js';
import type { AuditSinkPort, EnginePort, MetricsSinkPort, TracerPort } from '../../domain/ports.js';

export interface VerifyUseCaseDeps {
  engine: EnginePort;
  audit: AuditSinkPort;
  metrics: MetricsSinkPort;
  tracer: TracerPort;
}

export class VerifyProofUseCase {
  constructor(private readonly deps: VerifyUseCaseDeps) {}

  async execute(
    submission: ProofSubmission,
    ctx: ExecutionContext,
  ): Promise<{ verified: boolean; circuitId: string; publicInputHash: string }> {
    const span = this.deps.tracer.startSpan('api.verify', { circuitId: submission.circuitId });
    const start = Date.now();
    let outcome;
    try {
      outcome = await this.deps.engine.verify(
        submission.circuitId,
        submission.publicInputs,
        submission.proof,
      );
    } finally {
      this.deps.metrics.duration('engine_verify_duration_seconds', Date.now() - start);
    }

    const anchor = publicInputHash(submission.publicInputs);
    await this.deps.audit.append({
      id: `aud_${randomUUID().slice(0, 8)}`,
      at: new Date().toISOString(),
      actor: ctx.actor,
      tenantId: ctx.tenantId,
      action: 'proof.verify',
      resource: '/v1/proofs/verify',
      outcome: outcome.valid ? 'granted' : 'denied',
      detail: { circuitId: submission.circuitId, verified: outcome.valid },
      ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
      requestId: ctx.requestId,
    });
    this.deps.metrics.inc('proofs_verified_total', 1, {
      circuitId: submission.circuitId,
      outcome: outcome.valid ? 'ok' : 'invalid',
    });

    span.setAttributes({ verified: outcome.valid, publicInputHash: anchor });
    if (outcome.valid) span.ok('verified');
    else span.fail('engine rejected the proof');
    span.end();

    if (!outcome.valid) {
      throw new DomainError('UNVERIFIED', {
        detail: `engine rejected the proof for circuit ${submission.circuitId}`,
      });
    }
    return { verified: true, circuitId: submission.circuitId, publicInputHash: anchor };
  }
}