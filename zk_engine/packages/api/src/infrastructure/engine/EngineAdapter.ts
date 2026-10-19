/**
 * Engine adapter — the ONLY consumer of @zkpe/engine (consumes the certified
 * interface only; drives no cryptographic verification/hashing of its own).
 *
 * `prove` intentionally does NOT exist here (ADR-0005: private inputs never
 * reach the API).
 */

import { Circuit, verify as engineVerify } from '@zkpe/engine';
import { artifactsExist, getCircuitDefinition, listCircuitIds } from '@zkpe/circuit-lib';
import type { Groth16Proof } from '@zkpe/proof-format';
import type { CircuitInfo, VerifyOutcome } from '../../domain/entities.js';
import { DomainError } from '../../domain/errors.js';
import type { EnginePort, MetricsSinkPort, TracerPort } from '../../domain/ports.js';
import { Semaphore } from '../util/Semaphore.js';

export class EngineAdapter implements EnginePort {
  private readonly sem: Semaphore;

  constructor(
    private readonly tracer: TracerPort,
    private readonly metrics?: MetricsSinkPort,
    maxConcurrent = 8,
  ) {
    this.sem = new Semaphore(maxConcurrent);
  }

  async listCircuits(): Promise<CircuitInfo[]> {
    return listCircuitIds().map((id) => {
      const def = getCircuitDefinition(id);
      return {
        circuitId: id,
        version: def.version,
        label: `${id}@${def.version}`,
        nPublic: def.inputs.length,
        artifactsReady: artifactsExist(def),
      };
    });
  }

  async verify(circuitId: string, publicInputs: string[], proof: Groth16Proof): Promise<VerifyOutcome> {
    const span = this.tracer.startSpan('engine.verify', { circuitId });
    // Bound concurrent snarkjs verify calls to prevent CPU exhaustion (§6)
    this.metrics?.gauge('engine_verify_inflight', this.sem.inflight);
    this.metrics?.gauge('engine_verify_queued', this.sem.queued);
    try {
      const result = await this.sem.run(async () => {
        const circuit = await Circuit.load(circuitId);
        return engineVerify(circuit, publicInputs, proof);
      });
      span.setAttributes({ valid: result.valid });
      if (result.valid) span.ok('verified');
      else span.fail('verification rejected');
      const outcome: VerifyOutcome = { valid: result.valid, circuitId };
      span.end();
      return outcome;
    } catch (err) {
      span.fail(err instanceof Error ? err.message : String(err));
      span.end();
      if (err instanceof DomainError) throw err;
      if (isUnknownCircuit(err)) {
        throw new DomainError('NOT-FOUND', { detail: `unknown circuit: ${circuitId}`, cause: err });
      }
      throw new DomainError('UPSTREAM-ENGINE', { detail: 'engine verify failed', cause: err });
    }
  }

  async healthy(): Promise<boolean> {
    const defs = listCircuitIds().map(getCircuitDefinition);
    return defs.length > 0 && defs.every((d) => artifactsExist(d));
  }
}

function isUnknownCircuit(err: unknown): boolean {
  return err instanceof Error && /unknown circuit|circuit.*(not found|unknown)/i.test(err.message);
}