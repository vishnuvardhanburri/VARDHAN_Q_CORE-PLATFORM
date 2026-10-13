import { describe, expect, it } from 'vitest';
import { generateKeyPair, signEnvelope } from '@zkpe/keys';
import { createEnvelope } from '@zkpe/proof-format';
import { getCircuitDefinition, loadManifest } from '@zkpe/circuit-lib';
import { artifactHashFromManifest, runGate } from '../scripts/gatekeeper-lib.mjs';

const CERT = 'poseidon-preimage';

function baseEnvelope(opts: { artifactHash?: string; vkHash?: string; publicInputs?: string[] } = {}) {
  const envelope = {
    circuitId: CERT,
    circuitVersion: '1.0.0',
    vkHash: opts.vkHash ?? '0x' + 'ab'.repeat(32),
    publicInputs: opts.publicInputs ?? ['42'],
    proof: {
      pi_a: ['1', '2', '3'] as [string, string, string],
      pi_b: [['1', '2'], ['3', '4'], ['5', '6']] as [[string, string], [string, string], [string, string]],
      pi_c: ['1', '2', '3'] as [string, string, string],
    },
  };
  if (opts.artifactHash) (envelope as { artifactHash?: string }).artifactHash = opts.artifactHash;
  return createEnvelope(envelope as never);
}

function signedEnv(env: ReturnType<typeof baseEnvelope>, key = generateKeyPair()) {
  return signEnvelope(env as never, { kind: 'privateJwk', privateJwk: key.privateJwk });
}

/** deps that short-circuit file IO, engine verification and on-chain calls */
function deps({
  envelopeJson,
  _artifactHash,
  chain = [],
  proofValid = true,
  disk,
}: {
  envelopeJson: string;
  _artifactHash?: string;
  chain?: Array<{ name: string; ok: boolean; detail: string }>;
  proofValid?: boolean;
  disk?: { r1cs: string; wasm: string; zkey: string; vkSha256: string; vkHash: string };
}) {
  return {
    readFile: async () => envelopeJson,
    engineVerify: async () => ({ valid: proofValid }),
    loadCircuit: async () => ({ id: CERT }),
    readDirArtifacts: async () => disk ?? null,
    chainCheck: async () => chain,
  };
}

const okChain = [
  { name: 'on-chain-circuit', ok: true, detail: 'registered + active' },
  { name: 'on-chain-vk', ok: true, detail: 'vk matches' },
  { name: 'on-chain-status', ok: true, detail: 'proved' },
  { name: 'on-chain-proof', ok: true, detail: 'exact proof leaf registered' },
  { name: 'on-chain-requireProved', ok: true, detail: 'unexpired' },
];

describe('gatekeeper-lib negative suite (M8)', () => {
  it('positive control: signed, bound, certified envelope passes', async () => {
    const manifest = loadManifest(getCircuitDefinition(CERT));
    const hash = artifactHashFromManifest(manifest);
    const key = generateKeyPair();
    const env = signedEnv(baseEnvelope({ artifactHash: hash, vkHash: manifest.artifacts.vk.vkHash }), key);
    const { verified, reasons } = await runGate(
      { envelopeFile: 'p.json', trustedPublicKey: JSON.stringify(key.publicJwk) },
      deps({
        envelopeJson: JSON.stringify(env),
        _artifactHash: hash,
        chain: okChain,
        disk: {
          r1cs: manifest.artifacts.r1cs,
          wasm: manifest.artifacts.wasm,
          zkey: manifest.artifacts.zkey,
          vkSha256: manifest.artifacts.vk.sha256,
          vkHash: manifest.artifacts.vk.vkHash,
        },
      }),
    );
    expect(reasons).toEqual([]);
    expect(verified).toBe(true);
  });

  it('blocks: malformed envelope (not JSON / bad shape)', async () => {
    const { verified, reasons } = await runGate(
      { envelopeFile: 'p.json', trustedPublicKey: JSON.stringify(generateKeyPair().publicJwk) },
      deps({ envelopeJson: '{not json' }),
    );
    expect(verified).toBe(false);
    expect(reasons.some((r) => r.includes('unreadable'))).toBe(true);
  });

  it('blocks: envelope for the wrong circuit', async () => {
    const key = generateKeyPair();
    const env = signedEnv(baseEnvelope(), key);
    const { verified, reasons } = await runGate(
      { envelopeFile: 'p.json', trustedPublicKey: JSON.stringify(key.publicJwk), circuit: 'merkle-inclusion' },
      deps({ envelopeJson: JSON.stringify(env) }),
    );
    expect(verified).toBe(false);
    expect(reasons.some((r) => r.includes('circuit-match'))).toBe(true);
  });

  it('blocks: vkHash not certified by circuit-lib', async () => {
    const key = generateKeyPair();
    const env = signedEnv(baseEnvelope(), key);
    const { verified, reasons } = await runGate(
      { envelopeFile: 'p.json', trustedPublicKey: JSON.stringify(key.publicJwk) },
      deps({ envelopeJson: JSON.stringify(env) }),
    );
    expect(verified).toBe(false);
    expect(reasons.some((r) => r.includes('vk-certified'))).toBe(true);
  });

  it('blocks: vkHash outside the explicit allow-list', async () => {
    const key = generateKeyPair();
    const env = signedEnv(baseEnvelope(), key);
    const { verified, reasons } = await runGate(
      {
        envelopeFile: 'p.json',
        trustedPublicKey: JSON.stringify(key.publicJwk),
        vkAllowlist: 'poseidon-preimage=0x' + 'cd'.repeat(32),
      },
      deps({ envelopeJson: JSON.stringify(env) }),
    );
    expect(verified).toBe(false);
    expect(reasons.some((r) => r.includes('vk-allowlist'))).toBe(true);
  });

  it('blocks: envelope carries no artifactHash', async () => {
    const key = generateKeyPair();
    const env = signedEnv(baseEnvelope(), key);
    const { verified, reasons } = await runGate(
      { envelopeFile: 'p.json', trustedPublicKey: JSON.stringify(key.publicJwk) },
      deps({ envelopeJson: JSON.stringify(env) }),
    );
    expect(verified).toBe(false);
    expect(reasons.some((r) => r.includes('artifact-bound'))).toBe(true);
  });

  it('blocks: artifactHash does not match the certified artifact bundle', async () => {
    const key = generateKeyPair();
    const env = signedEnv(baseEnvelope({ artifactHash: '0x' + '11'.repeat(32) }), key);
    const { verified, reasons } = await runGate(
      { envelopeFile: 'p.json', trustedPublicKey: JSON.stringify(key.publicJwk) },
      deps({ envelopeJson: JSON.stringify(env), _artifactHash: '0x' + '11'.repeat(32) }),
    );
    expect(verified).toBe(false);
    expect(reasons.some((r) => r.includes('artifact'))).toBe(true);
  });

  it('blocks: on-disk artifact set differs from the certified manifest', async () => {
    const manifest = loadManifest(getCircuitDefinition(CERT));
    const hash = artifactHashFromManifest(manifest);
    const key = generateKeyPair();
    const env = signedEnv(baseEnvelope({ artifactHash: hash, vkHash: manifest.artifacts.vk.vkHash }), key);
    const { verified, reasons } = await runGate(
      { envelopeFile: 'p.json', trustedPublicKey: JSON.stringify(key.publicJwk), artifactDir: '/somewhere' },
      deps({
        envelopeJson: JSON.stringify(env),
        _artifactHash: hash,
        disk: { r1cs: '0x' + '22'.repeat(32), wasm: '0x22', zkey: '0x22', vkSha256: '0x22', vkHash: '0x22' },
      }),
    );
    expect(verified).toBe(false);
    expect(reasons.some((r) => r.includes('artifact-disk'))).toBe(true);
  });

  it('blocks: cryptographic proof invalid (tampered proof)', async () => {
    const key = generateKeyPair();
    const env = signedEnv(baseEnvelope(), key);
    const { verified, reasons } = await runGate(
      { envelopeFile: 'p.json', trustedPublicKey: JSON.stringify(key.publicJwk) },
      deps({ envelopeJson: JSON.stringify(env), proofValid: false }),
    );
    expect(verified).toBe(false);
    expect(reasons.some((r) => r.includes('proof-valid'))).toBe(true);
  });

  it('blocks: unsigned envelope under require-signed', async () => {
    const key = generateKeyPair();
    const env = baseEnvelope() as never;
    const { verified, reasons } = await runGate(
      { envelopeFile: 'p.json', trustedPublicKey: JSON.stringify(key.publicJwk), requireSigned: true },
      deps({ envelopeJson: JSON.stringify(env) }),
    );
    expect(verified).toBe(false);
    expect(reasons.some((r) => r.includes('signature'))).toBe(true);
  });

  it('blocks: signature from a DIFFERENT (untrusted) key', async () => {
    const attacker = generateKeyPair();
    const trusted = generateKeyPair();
    const env = signedEnv(baseEnvelope(), attacker);
    const { verified, reasons } = await runGate(
      { envelopeFile: 'p.json', trustedPublicKey: JSON.stringify(trusted.publicJwk) },
      deps({ envelopeJson: JSON.stringify(env) }),
    );
    expect(verified).toBe(false);
    expect(reasons.some((r) => r.includes('signature'))).toBe(true);
  });

  it('blocks: no trusted key supplied (fail-closed)', async () => {
    const env = signedEnv(baseEnvelope());
    const { verified, reasons } = await runGate(
      { envelopeFile: 'p.json' },
      deps({ envelopeJson: JSON.stringify(env) }),
    );
    expect(verified).toBe(false);
    expect(reasons.some((r) => r.includes('no trusted verification key'))).toBe(true);
  });

  it('blocks: claim proved on-chain but the EXACT proof object is not the anchored leaf', async () => {
    const key = generateKeyPair();
    const env = signedEnv(baseEnvelope(), key);
    const { verified, reasons } = await runGate(
      {
        envelopeFile: 'p.json',
        trustedPublicKey: JSON.stringify(key.publicJwk),
        registry: { rpcUrl: 'x', proxy: '0x00' },
      },
      deps({
        envelopeJson: JSON.stringify(env),
        chain: [
          { name: 'on-chain-circuit', ok: true, detail: 'registered' },
          { name: 'on-chain-vk', ok: true, detail: 'vk matches' },
          { name: 'on-chain-status', ok: true, detail: 'proved' },
          { name: 'on-chain-proof', ok: false, detail: 'proof NOT exactly anchored on-chain' },
          { name: 'on-chain-requireProved', ok: true, detail: 'unexpired' },
        ],
      }),
    );
    expect(verified).toBe(false);
    expect(reasons.some((r) => r.includes('on-chain-proof'))).toBe(true);
  });

  it('blocks: proof not registered on-chain', async () => {
    const key = generateKeyPair();
    const env = signedEnv(baseEnvelope(), key);
    const { verified, reasons } = await runGate(
      {
        envelopeFile: 'p.json',
        trustedPublicKey: JSON.stringify(key.publicJwk),
        registry: { rpcUrl: 'x', proxy: '0x00' },
      },
      deps({
        envelopeJson: JSON.stringify(env),
        chain: [
          { name: 'on-chain-circuit', ok: true, detail: 'registered' },
          { name: 'on-chain-vk', ok: true, detail: 'vk matches' },
          { name: 'on-chain-status', ok: false, detail: 'unregistered' },
          { name: 'on-chain-requireProved', ok: false, detail: 'revert' },
        ],
      }),
    );
    expect(verified).toBe(false);
    expect(reasons.some((r) => r.includes('on-chain-status'))).toBe(true);
  });

  it('blocks: proof REVOKED on-chain', async () => {
    const key = generateKeyPair();
    const env = signedEnv(baseEnvelope(), key);
    const { verified, reasons } = await runGate(
      {
        envelopeFile: 'p.json',
        trustedPublicKey: JSON.stringify(key.publicJwk),
        registry: { rpcUrl: 'x', proxy: '0x00' },
      },
      deps({
        envelopeJson: JSON.stringify(env),
        chain: [
          { name: 'on-chain-circuit', ok: true, detail: 'registered' },
          { name: 'on-chain-vk', ok: true, detail: 'vk matches' },
          { name: 'on-chain-status', ok: false, detail: 'revoked' },
          { name: 'on-chain-requireProved', ok: false, detail: 'revert ProofIsRevoked' },
        ],
      }),
    );
    expect(verified).toBe(false);
    expect(reasons.some((r) => r.includes('on-chain-status'))).toBe(true);
  });

  it('blocks: proof EXPIRED on-chain (requireProved reverts)', async () => {
    const key = generateKeyPair();
    const env = signedEnv(baseEnvelope(), key);
    const { verified, reasons } = await runGate(
      {
        envelopeFile: 'p.json',
        trustedPublicKey: JSON.stringify(key.publicJwk),
        registry: { rpcUrl: 'x', proxy: '0x00', maxAge: 3600 },
      },
      deps({
        envelopeJson: JSON.stringify(env),
        chain: [
          { name: 'on-chain-circuit', ok: true, detail: 'registered' },
          { name: 'on-chain-vk', ok: true, detail: 'vk matches' },
          { name: 'on-chain-status', ok: true, detail: 'proved' },
          { name: 'on-chain-requireProved', ok: false, detail: 'revert ProofExpired' },
        ],
      }),
    );
    expect(verified).toBe(false);
    expect(reasons.some((r) => r.includes('requireProved'))).toBe(true);
  });
});
