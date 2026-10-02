/**
 * Runtime circuit handle for the engine (ADR-0007).
 *
 * A {@link Circuit} binds a {@link CircuitDefinition} (from circuit-lib) to
 * its certified manifest and on-disk artifacts. Every use passes through
 * `assertArtifactsIntact()` (Security T1: manifest hashes checked before
 * artifacts are loaded).
 */

import { existsSync, readFileSync } from 'node:fs';
import type { CircuitManifest } from '@zkpe/proof-format';
import {
  type CircuitDefinition,
  artifactPaths,
  checkArtifacts,
  getCircuitDefinition,
  loadArtifactHashes,
  loadManifest,
  type ArtifactHashes,
} from '@zkpe/circuit-lib';
import type { VerificationKey } from './keys.js';

/** A loaded, integrity-checked circuit. */
export class Circuit {
  /** Static definition (id, version, interface, budgets). */
  readonly def: CircuitDefinition;
  /** Certified manifest (committed contract). */
  readonly manifest: CircuitManifest;

  private constructor(def: CircuitDefinition, manifest: CircuitManifest) {
    this.def = def;
    this.manifest = manifest;
  }

  /**
   * Load a circuit by id from the certified circuit-lib artifacts.
   * Throws if the circuit is unknown, artifacts are missing, or artifact
   * digests no longer match the certified manifest.
   */
  static async load(id: string): Promise<Circuit> {
    const def = getCircuitDefinition(id);
    await checkArtifacts(def);
    return new Circuit(def, loadManifest(def));
  }

  /** Absolute artifact paths (r1cs, wasm, zkey, vk). */
  get artifactPaths(): ReturnType<typeof artifactPaths> {
    return artifactPaths(this.def);
  }

  /** True if all artifacts are present on disk (and were certified). */
  get artifactsReady(): boolean {
    return existsSync(this.artifactPaths.zkey) && existsSync(this.artifactPaths.vk);
  }

  /** Recompute artifact digests from disk (for audits and 2-run checks). */
  async artifactHashes(): Promise<ArtifactHashes> {
    return loadArtifactHashes(this.def);
  }

  /** The verification key, loaded from the certified artifact file. */
  get verificationKey(): VerificationKey {
    const raw = readFileSync(this.artifactPaths.vk, 'utf8');
    return JSON.parse(raw) as VerificationKey;
  }

  /** Human-readable summary for logs and task metadata. */
  get label(): string {
    return `${this.def.id}@${this.def.version}`;
  }
}
