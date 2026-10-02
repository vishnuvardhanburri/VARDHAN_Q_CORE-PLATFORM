/**
 * Integration tests for the certified v1 circuit artifacts (ADR-0008).
 *
 * These tests run ONLY when `build:circuits` + `build:ptau` + `keygen` have
 * produced artifacts (`packages/circuit-lib/build/`); otherwise they skip,
 * so unit-only CI still passes. Run the full chain with
 * `npm run build:circuits -w @zkpe/circuit-lib` first.
 *
 * Coverage per circuit:
 *   1. witness public signals match the independent JS oracle
 *   2. groth16 prove + verify round-trip
 *   3. tamper negatives (bad witness value, corrupted proof) fail as expected
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as snarkjs from 'snarkjs';
import { buildPoseidonReference } from 'circomlibjs';
import { getCircuitDefinition } from '../src/circuits.js';
import { artifactPaths, artifactsExist, checkArtifacts, loadManifest } from '../src/artifacts.js';

type Poseidon = Awaited<ReturnType<typeof buildPoseidonReference>>;
let poseidon: Poseidon | undefined;

async function getPoseidon(): Promise<Poseidon> {
  poseidon ??= await buildPoseidonReference();
  return poseidon;
}

/** Field-element output of the JS Poseidon oracle (decimal string). */
async function hash2(a: bigint, b: bigint): Promise<string> {
  const p = await getPoseidon();
  return p.F.toString(p([a, b]));
}

function skipWhenNoArtifacts(def: ReturnType<typeof getCircuitDefinition>) {
  return artifactsExist(def) ? describe : describe.skip;
}

describe('poseidon-preimage@1 (certified artifacts)', () => {
  const def = getCircuitDefinition('poseidon-preimage');
  const artifacts = artifactPaths(def);
  const run = skipWhenNoArtifacts(def);

  (run ?? describe)('witness + proof', () => {
    const [x, y] = [123456789n, 987654321n];

    it('public signal equals the JS Poseidon oracle and nothing leaks', async () => {
      const { publicSignals } = await snarkjs.groth16.fullProve(
        { preimage: [x.toString(), y.toString()] },
        artifacts.wasm,
        artifacts.zkey,
      );
      expect(publicSignals).toHaveLength(1);
      expect(publicSignals[0]).toBe(await hash2(x, y));
    });

    it('prove + verify round-trip; tampered proof is rejected', async () => {
      const vk = JSON.parse(readFileSync(artifacts.vk, 'utf8'));
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        { preimage: [x.toString(), y.toString()] },
        artifacts.wasm,
        artifacts.zkey,
      );
      expect(await snarkjs.groth16.verify(vk, publicSignals, proof)).toBe(true);

      // Tamper: flip a coordinate in pi_a.
      const tampered = structuredClone(proof) as { pi_a: [string, string, string] };
      tampered.pi_a[0] = (BigInt(tampered.pi_a[0]) + 1n).toString();
      expect(await snarkjs.groth16.verify(vk, publicSignals, tampered)).toBe(false);
    });

    it('a different preimage yields a different digest', async () => {
      const { publicSignals } = await snarkjs.groth16.fullProve(
        { preimage: [x.toString(), (y + 1n).toString()] },
        artifacts.wasm,
        artifacts.zkey,
      );
      expect(publicSignals[0]).not.toBe(await hash2(x, y));
    });
  });
});

describe('merkle-inclusion@1 (certified artifacts)', () => {
  const def = getCircuitDefinition('merkle-inclusion');
  const artifacts = artifactPaths(def);
  const run = skipWhenNoArtifacts(def);

  (run ?? describe)('witness + proof', () => {
    const HEIGHT = 4;
    const N_LEAVES = 2 ** HEIGHT;

    async function path(index: number) {
      const p = await getPoseidon();
      const leaves = [] as bigint[];
      for (let i = 0; i < N_LEAVES; i++) {
        leaves.push(BigInt(p.F.toString(p([BigInt(i), 1n]))));
      }
      const levels: bigint[][] = [leaves];
      while (levels[levels.length - 1]!.length > 1) {
        const prev = levels[levels.length - 1]!;
        const next = [] as bigint[];
        for (let i = 0; i < prev.length; i += 2) {
          next.push(BigInt(p.F.toString(p([prev[i]!, prev[i + 1]!]))));
        }
        levels.push(next);
      }

      const pathBits: number[] = [];
      const siblings: string[] = [];
      let cur = leaves[index]!;
      for (let i = 0; i < HEIGHT; i++) {
        const pos = index >> i;
        const arr = levels[i]!;
        const sibling = (pos & 1) === 1 ? arr[pos - 1]! : arr[pos + 1]!;
        pathBits.push(pos & 1);
        siblings.push(sibling.toString());
        const [l, r] = (pos & 1) === 1 ? [sibling, cur] : [cur, sibling];
        cur = BigInt(p.F.toString(p([l, r])));
      }
      const root = levels[HEIGHT]![0]!;
      return { root, leaf: leaves[index]!, siblings, pathBits };
    }

    it('prove membership of leaf 7 and verify; public root + isZero=1', async () => {
      const { root, leaf, siblings, pathBits } = await path(7);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        { root: root.toString(), leaf: leaf.toString(), siblings, pathBits },
        artifacts.wasm,
        artifacts.zkey,
      );
      const vk = JSON.parse(readFileSync(artifacts.vk, 'utf8'));
      expect(await snarkjs.groth16.verify(vk, publicSignals, proof)).toBe(true);
      expect(publicSignals[0]).toBe(root.toString()); // rootPub
      expect(publicSignals[1]).toBe('1'); // isZero
    });

    it('wrong root yields isZero=0 (proof valid but assertion fails)', async () => {
      const { root, leaf, siblings, pathBits } = await path(7);
      const wrongRoot = (root + 1n).toString();
      const { publicSignals } = await snarkjs.groth16.fullProve(
        { root: wrongRoot, leaf: leaf.toString(), siblings, pathBits },
        artifacts.wasm,
        artifacts.zkey,
      );
      expect(publicSignals[0]).toBe(wrongRoot);
      expect(publicSignals[1]).toBe('0');
    });

    it('wrong leaf yields isZero=0 (proof valid but assertion fails)', async () => {
      const { root, leaf, siblings, pathBits } = await path(7);
      const { publicSignals } = await snarkjs.groth16.fullProve(
        { root: root.toString(), leaf: (leaf + 1n).toString(), siblings, pathBits },
        artifacts.wasm,
        artifacts.zkey,
      );
      expect(publicSignals[0]).toBe(root.toString());
      expect(publicSignals[1]).toBe('0');
    });

    it('non-binary path bits are rejected by the witness (constraint violation)', async () => {
      const { root, leaf, siblings, pathBits } = await path(7);
      const badBits = [...pathBits];
      badBits[0] = 2;
      await expect(
        snarkjs.groth16.fullProve(
          { root: root.toString(), leaf: leaf.toString(), siblings, pathBits: badBits },
          artifacts.wasm,
          artifacts.zkey,
        ),
      ).rejects.toThrow();
    });
  });
});

describe('certified manifest integrity (Security T1)', () => {
  const def = getCircuitDefinition('poseidon-preimage');

  it('manifest hash is reproduced on re-reading (2-run acceptance)', async () => {
    if (!artifactsExist(def)) return;
    const first = loadManifest(def);
    const second = loadManifest(def);
    expect(second.manifestHash).toBe(first.manifestHash);
    await expect(checkArtifacts(def)).resolves.toBeUndefined();
  });
});
