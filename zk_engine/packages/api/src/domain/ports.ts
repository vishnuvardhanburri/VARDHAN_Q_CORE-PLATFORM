/**
 * Ports (interfaces) — the inward-facing boundary of the application core.
 *
 * Implemented by infrastructure adapters and consumed by use cases. The
 * application layer depends on these interfaces only; nothing here touches
 * http, ethers, snarkjs, or the engine package directly.
 */

import type { Groth16Proof } from '@zkpe/proof-format';
import type {
  AuditAction,
  AuditEvent,
  ChainCircuitConfig,
  CircuitInfo,
  ClientSecret,
  IdempotencyRecord,
  ProofStatusEntry,
  RegistryInfo,
  VerifyOutcome,
} from './entities.js';

/** Circuit catalog + verification (ADR-0005 category (a): local crypto). */
export interface EnginePort {
  listCircuits(): Promise<CircuitInfo[]>;
  verify(circuitId: string, publicInputs: string[], proof: Groth16Proof): Promise<VerifyOutcome>;
  /** True when certified artifacts for all known circuits are present. */
  healthy(): Promise<boolean>;
}

/** Registry reads (ADR-0005 category (b): chain status). */
export interface RegistryReadPort {
  getCircuit(circuitId: string): Promise<ChainCircuitConfig | null>;
  getProofStatus(circuitId: string, publicInputHash: string): Promise<ProofStatusEntry>;
  registryInfo(circuitIds: string[]): Promise<RegistryInfo>;
  healthy(): Promise<boolean>;
}

/** Registry write path (write role — "deploy key"). */
export interface RegistryWritePort {
  registerProof(circuitId: string, proof: Groth16Proof, publicInputs: string[]): Promise<{ txHash: string }>;
}

export interface SecretStorePort {
  lookup(clientId: string): Promise<ClientSecret | null>;
}

export interface NonceStorePort {
  /** True when `nonce` is fresh for `clientId` (and now reserved). */
  consume(clientId: string, nonce: string, ttlMs: number, nowMs: number): Promise<boolean>;
}

export interface IdempotencyStorePort {
  get(keyHash: string): Promise<IdempotencyRecord | null>;
  put(keyHash: string, record: IdempotencyRecord, ttlMs: number): Promise<void>;
}

export interface AuditSinkPort {
  append(event: AuditEvent): Promise<void>;
  /** Returns events in reverse chronological order, optionally filtered by action and/or tenantId. */
  recent(limit: number, action?: AuditAction, tenantId?: string): Promise<AuditEvent[]>;
}

export interface MetricsSinkPort {
  inc(name: string, count?: number, labels?: Record<string, string>): void;
  gauge(name: string, value: number): void;
  duration(name: string, valueMs: number): void;
  render(): string;
}

/** OTel tracer minimal surface (prevents infra coupling inside application). */
export interface TracerPort {
  startSpan(name: string, attrs?: Record<string, string | number | boolean>): SpanHandle;
  active(): SpanHandle | null;
}

export interface SpanHandle {
  setAttributes(attrs: Record<string, string | number | boolean>): void;
  ok(msg?: string): void;
  fail(msg: string): void;
  end(): void;
}

export interface ClockPort {
  nowMs(): number;
}