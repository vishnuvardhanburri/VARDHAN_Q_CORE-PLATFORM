/**
 * Verify locally then anchor on-chain (write role). Orchestrates the engine +
 * registry ports; computes no hashes itself — proof-format owns
 * `publicInputHash`, the contract owns the ABI digest internally.
 */

import { randomUUID } from 'node:crypto';
import { publicInputHash } from '@zkpe/proof-format';
import type { ExecutionContext, ProofSubmission } from '../../domain/entities.js';
import { DomainError } from '../../domain/errors.js';
import type {
  AuditSinkPort,
  EnginePort,
  MetricsSinkPort,
  RegistryReadPort,
  RegistryWritePort,
  TracerPort,
} from '../../domain/ports.js';

export interface RegisterUseCaseDeps {
  engine: EnginePort;
  registryRead: RegistryReadPort;
  registryWrite: RegistryWritePort;
  audit: AuditSinkPort;
  metrics: MetricsSinkPort;
  tracer: TracerPort;
}

export class RegisterProofUseCase {
  constructor(private readonly deps: RegisterUseCaseDeps) {}

  async register(
    submission: ProofSubmission,
    ctx: ExecutionContext,
  ): Promise<{ publicInputHash: string; txHash: string; circuitId: string }> {
    const span = this.deps.tracer.startSpan('api.register', { circuitId: submission.circuitId });

    const circuit = await this.deps.registryRead.getCircuit(submission.circuitId).catch((e) => {
      throw new DomainError('UPSTREAM-REGISTRY', { detail: 'getCircuit failed', cause: e });
    });
    if (!circuit) throw new DomainError('NOT-FOUND', { detail: `circuit ${submission.circuitId} is not registered on-chain` });

    const outcome = await this.deps.engine.verify(
      submission.circuitId,
      submission.publicInputs,
      submission.proof,
    );
    if (!outcome.valid) {
      span.fail('engine rejected before registration');
      span.end();
      throw new DomainError('UNVERIFIED', {
        detail: `proof rejected for circuit ${submission.circuitId}; nothing was written`,
      });
    }

    let written;
    try {
      written = await this.deps.registryWrite.registerProof(
        submission.circuitId,
        submission.proof,
        submission.publicInputs,
      );
    } catch (e) {
      span.fail('registry write failed');
      span.end();
      throw new DomainError('UPSTREAM-REGISTRY', { detail: `registerProof failed: ${e instanceof Error ? e.message : String(e)}`, cause: e });
    }

    const anchor = publicInputHash(submission.publicInputs);
    await this.deps.audit.append({
      id: `aud_${randomUUID().slice(0, 8)}`,
      at: new Date().toISOString(),
      actor: ctx.actor,
      tenantId: ctx.tenantId,
      action: 'proof.register',
      resource: '/v1/proofs/register',
      outcome: 'ok',
      detail: { circuitId: submission.circuitId, txHash: written.txHash },
      ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
      requestId: ctx.requestId,
    });
    this.deps.metrics.inc('proofs_registered_total', 1, { circuitId: submission.circuitId });
    this.deps.metrics.inc('registry_writes_total', 1, { op: 'registerProof' });
    span.setAttributes({ publicInputHash: anchor, txHash: written.txHash });
    span.ok('registered');
    span.end();

    return { publicInputHash: anchor, txHash: written.txHash, circuitId: submission.circuitId };
  }
}