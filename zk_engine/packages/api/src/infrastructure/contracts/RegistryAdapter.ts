/**
 * Registry adapter — ethers v6 over the *compiled* ABI artifact
 * (contracts/out/ZKVerifierRegistry.sol/ZKVerifierRegistry.json). Implements
 * the registry read/write ports (§20). All BYTES32 arguments and the public
 * anchor come from proof-format — this class never hashes, ABI-encodes, or
 * does field math.
 *
 * Migrated from ethers v5 → v6 (2026-08-11):
 *  - providers.JsonRpcProvider → JsonRpcProvider (top-level import)
 *  - ContractInterface       → InterfaceAbi
 *  - constants.AddressZero   → ZeroAddress
 *  - utils.hexZeroPad(v, n)  → zeroPadValue(v, n)
 *  - BigNumber.from(n)       → BigInt(n)  (native bigint, no wrapper needed)
 *
 * Contract calls are cast to `any` at the call site because ethers v6's
 * Contract returns an opaque BaseContractMethod proxy that TypeScript cannot
 * type-narrow without a full typechain-generated binding, which is out of
 * scope here. The cast is explicit and local — it does NOT bypass any
 * cryptographic or authorization logic.
 */

import { readFileSync } from 'node:fs';
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  ZeroAddress,
  zeroPadValue,
  type InterfaceAbi,
} from 'ethers';
import { circuitIdBytes32 } from '@zkpe/proof-format';
import type { Groth16Proof } from '@zkpe/proof-format';
import type { ChainCircuitConfig, ProofStatusEntry, RegistryInfo } from '../../domain/entities.js';
import { DomainError } from '../../domain/errors.js';
import type { RegistryWritePort, TracerPort } from '../../domain/ports.js';
import { findRepoRoot, registryAbiPath } from '../util/paths.js';

export interface RegistryAdapterConfig {
  rpcUrl: string;
  proxy?: string;
  privateKey?: string;
  abiPath?: string;
}

// Ethers v6 Contract proxy returns method-per-name via Proxy; there is no
// static typing without a full typechain-generated binding. We declare a
// minimal callable interface and use it for all call sites. The cast is
// explicit, documented, and entirely local — it does not bypass any
// cryptographic or authorization logic.
interface AnyContract {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [method: string]: ((...args: any[]) => Promise<any>) | unknown;
}

// Helper to assert a method is callable without the `| unknown` widening.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function call(c: AnyContract, method: string, ...args: any[]): Promise<any> {
  const fn = c[method];
  if (typeof fn !== 'function') throw new Error(`Contract method ${method} not found`);
  return fn(...args) as Promise<unknown>;
}

export class RegistryAdapter {
  private readonly provider: JsonRpcProvider;
  private readonly proxy: string | null;
  private readonly abi: InterfaceAbi;
  private readonly write: RegistryWritePort | null;

  constructor(cfg: RegistryAdapterConfig, private readonly tracer: TracerPort) {
    if (!cfg.rpcUrl) throw new DomainError('INTERNAL', { detail: 'RegistryAdapter requires rpcUrl' });
    this.provider = new JsonRpcProvider(cfg.rpcUrl);
    this.proxy = cfg.proxy ? cfg.proxy.toLowerCase() : null;
    const abiPath = cfg.abiPath ?? registryAbiPath(findRepoRoot(import.meta.url));
    this.abi = (JSON.parse(readFileSync(abiPath, 'utf8')) as { abi: InterfaceAbi }).abi;
    this.write =
      this.proxy && cfg.privateKey
        ? new WriteRegistry(this.provider, this.proxy, this.abi, cfg.privateKey, tracer)
        : null;
  }

  hasWrite(): boolean {
    return this.write !== null;
  }

  writer(): RegistryWritePort | null {
    return this.write;
  }

  private contract(): AnyContract {
    if (!this.proxy) throw new DomainError('OUT-OF-SERVICE', { detail: 'registry proxy not configured' });
    return new Contract(this.proxy, this.abi, this.provider) as unknown as AnyContract;
  }

  async getCircuit(circuitId: string): Promise<ChainCircuitConfig | null> {
    const span = this.tracer.startSpan('registry.getCircuit', { circuitId });
    try {
      const [verifier, vkHashRaw, active] = await call(this.contract(), 'circuits', circuitIdBytes32(circuitId)) as [string, bigint, boolean];
      if (verifier === ZeroAddress) return null;
      const vkHash = zeroPadValue(`0x${BigInt(vkHashRaw).toString(16).padStart(64, '0')}`, 32);
      return {
        verifier: String(verifier).toLowerCase(),
        vkHash,
        active: Boolean(active),
      };
    } finally {
      span.end();
    }
  }

  async getProofStatus(circuitId: string, anchorHex: string): Promise<ProofStatusEntry> {
    const span = this.tracer.startSpan('registry.getProofStatus');
    try {
      const [status, provedAt] = await call(this.contract(), 'getProofStatus',
        circuitIdBytes32(circuitId),
        anchorHex,
      ) as [bigint, bigint];
      return {
        status: Number(status) === 1 ? 'proved' : Number(status) === 2 ? 'revoked' : 'unproved',
        provedAt: provedAt.toString(),
      };
    } finally {
      span.end();
    }
  }

  async registryInfo(circuitIds: string[]): Promise<RegistryInfo> {
    const span = this.tracer.startSpan('registry.registryInfo');
    try {
      const c = this.contract();
      const [schemaVersion, totalProofs, paused] = await Promise.all([
        call(c, 'getSchemaVersion') as Promise<bigint>,
        call(c, 'totalProofs') as Promise<bigint>,
        call(c, 'paused') as Promise<boolean>,
      ]);
      const circuits: RegistryInfo['circuits'] = {};
      for (const id of circuitIds) {
        const cfg = await this.getCircuit(id).catch(() => null);
        if (cfg) circuits[id] = cfg;
      }
      return {
        proxy: this.proxy ?? '',
        schemaVersion: (schemaVersion as bigint).toString(),
        totalProofs: (totalProofs as bigint).toString(),
        paused: Boolean(paused),
        circuits,
      };
    } finally {
      span.end();
    }
  }

  async healthy(): Promise<boolean> {
    if (!this.proxy) return false;
    try {
      await call(this.contract(), 'getSchemaVersion');
      return true;
    } catch {
      return false;
    }
  }
}

class WriteRegistry implements RegistryWritePort {
  private readonly contract: AnyContract;

  constructor(
    provider: JsonRpcProvider,
    proxy: string,
    abi: InterfaceAbi,
    privateKey: string,
    private readonly tracer: TracerPort,
  ) {
    this.contract = new Contract(proxy, abi, new Wallet(privateKey, provider)) as unknown as AnyContract;
  }

  async registerProof(circuitId: string, proof: Groth16Proof, publicInputs: string[]): Promise<{ txHash: string }> {
    const span = this.tracer.startSpan('registry.registerProof', { circuitId });
    try {
      const [verifier, vkHash] = await call(this.contract, 'circuits', circuitIdBytes32(circuitId)) as [string, bigint];
      if (verifier === ZeroAddress) {
        throw new Error(`circuit ${circuitId} not registered on-chain`);
      }
      const vkHashHex = zeroPadValue(`0x${BigInt(vkHash).toString(16).padStart(64, '0')}`, 32);

      // Convert proof coordinates to native BigInt (ethers v6 drops BigNumber wrapper)
      const a = proof.pi_a.slice(0, 2).map((n) => BigInt(n));
      // snarkjs serializes the G2 Fp2 coefficients imaginary-first; the
      // snarkjs-generated Verifier.sol expects real-first — swap each pair.
      const b = proof.pi_b.slice(0, 2).map((row: [string, string]) => [BigInt(row[1]), BigInt(row[0])]);
      const c = proof.pi_c.slice(0, 2).map((n) => BigInt(n));

      const tx = await call(this.contract, 'registerProof',
        circuitIdBytes32(circuitId),
        vkHashHex,
        a,
        b,
        c,
        publicInputs.map((n) => BigInt(n)),
      ) as { hash: string; wait(confirms?: number): Promise<unknown> };
      await tx.wait(1);
      span.setAttributes({ txHash: tx.hash });
      span.ok('registered');
      return { txHash: tx.hash };
    } finally {
      span.end();
    }
  }
}