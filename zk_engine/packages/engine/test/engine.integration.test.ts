/**
 * Integration tests: `Circuit` handle, prover, verifier, and dev key
 * management against the certified circuit-lib artifacts.
 *
 * These run only when `packages/circuit-lib/build/` contains certified
 * artifacts (`npm run build:circuits -w @zkpe/circuit-lib` first); otherwise
 * they skip so unit-only CI stays green.
 */

import { describe, expect, it } from 'vitest';
import { buildPoseidonReference } from 'circomlibjs';
import { artifactsExist, getCircuitDefinition } from '@zkpe/circuit-lib';
import { Circuit } from '../src/circuit.js';
import { InputValidationError } from '../src/inputs.js';
import { verifyDevPtau } from '../src/keys.js';
import { prove } from '../src/prover.js';
import { verify } from '../src/verifier.js';

const artifactsReady = [getCircuitDefinition('poseidon-preimage'), getCircuitDefinition('merkle-inclusion')]
  .every(artifactsExist);

describe.skipIf(!artifactsReady)('engine integration (certified artifacts)', () => {
  it('loads circuits with intact manifests (Security T1)', async () => {
    const circuit = await Circuit.load('poseidon-preimage');
    expect(circuit.label).toBe('poseidon-preimage@1.0.0');
    expect(circuit.manifest.circuitId).toBe('poseidon-preimage');
    expect(circuit.artifactsReady).toBe(true);
    const hashes = await circuit.artifactHashes();
    expect(circuit.manifest.artifacts.r1cs).toBe(hashes.r1cs);
    expect(circuit.verificationKey.nPublic).toBe(1);
  });

  it('poseidon-preimage: prove, verify, oracle match, tamper negative', async () => {
    const circuit = await Circuit.load('poseidon-preimage');
    const { proof, publicSignals, task } = await prove(circuit, {
      preimage: ['123456789', '987654321'],
    });
    expect(task.status).toBe('ok');
    expect(task.kind).toBe('prove');
    expect(task.inputHash).toMatch(/^0x[0-9a-f]{64}$/);

    const oracle = await buildPoseidonReference();
    const expected = oracle.F.toString(oracle([123456789n, 987654321n]));
    expect(publicSignals).toEqual([expected]);

    const { valid } = await verify(circuit, publicSignals, proof);
    expect(valid).toBe(true);

    const tampered = structuredClone(proof);
    tampered.pi_c[1] = (BigInt(tampered.pi_c[1]) + 1n).toString();
    const { valid: badValid } = await verify(circuit, publicSignals, tampered);
    expect(badValid).toBe(false);
  });

  it('poseidon-preimage: invalid inputs are rejected before proving', async () => {
    const circuit = await Circuit.load('poseidon-preimage');
    await expect(prove(circuit, { preimage: ['1'] })).rejects.toThrow(InputValidationError);
    await expect(prove(circuit, { preimage: ['bad', '2'] })).rejects.toThrow(InputValidationError);
  });

  it('merkle-inclusion: prove membership with public root binding', async () => {
    const circuit = await Circuit.load('merkle-inclusion');
    const p = await buildPoseidonReference();
    const leaves = [] as bigint[];
    for (let i = 0; i < 16; i++) leaves.push(BigInt(p.F.toString(p([BigInt(i), 7n]))));
    const levels: bigint[][] = [leaves];
    while (levels[levels.length - 1]!.length > 1) {
      const prev = levels[levels.length - 1]!;
      const next = [] as bigint[];
      for (let i = 0; i < prev.length; i += 2) next.push(BigInt(p.F.toString(p([prev[i]!, prev[i + 1]!]))));
      levels.push(next);
    }
    const index = 5;
    const pathBits: number[] = [];
    const siblings: string[] = [];
    let cur = leaves[index]!;
    for (let i = 0; i < 4; i++) {
      const pos = index >> i;
      const arr = levels[i]!;
      const sibling = (pos & 1) === 1 ? arr[pos - 1]! : arr[pos + 1]!;
      pathBits.push(pos & 1);
      siblings.push(sibling.toString());
      const [l, r] = (pos & 1) === 1 ? [sibling, cur] : [cur, sibling];
      cur = BigInt(p.F.toString(p([l, r])));
    }
    const root = levels[4]![0]!;

    const { proof, publicSignals } = await prove(circuit, {
      root: root.toString(),
      leaf: leaves[index]!.toString(),
      siblings,
      pathBits,
    });
    expect(publicSignals[0]).toBe(root.toString());
    expect(publicSignals[1]).toBe('1');

    const { valid } = await verify(circuit, publicSignals, proof);
    expect(valid).toBe(true);

    const wrong = await prove(circuit, {
      root: (root + 1n).toString(),
      leaf: leaves[index]!.toString(),
      siblings,
      pathBits,
    });
    expect(wrong.publicSignals[1]).toBe('0');
    const { valid: wrongValid } = await verify(circuit, wrong.publicSignals, wrong.proof);
    expect(wrongValid).toBe(true); // valid proof, failed assertion — consumers must check isZero
  });

  it('verifies the deterministic dev PTau checksum', async () => {
    const ptau = await verifyDevPtau();
    expect(ptau).toMatch(/ptau16_dev\.ptau$/);
  });

  it('verify rejects malformed proof objects', async () => {
    const circuit = await Circuit.load('poseidon-preimage');
    const { proof, publicSignals } = await prove(circuit, { preimage: ['1', '2'] });
    await expect(verify(circuit, publicSignals, { ...proof, pi_a: undefined as never })).rejects.toThrow();
  });
});
