#!/usr/bin/env node
/* global process, fetch, Buffer */
/**
 * Gatekeeper core (M8 security review v2) — the single trusted gate logic.
 *
 * Pure-ish module: no process.exit, no global state; all checks return a
 * structured report. Consumed by `gatekeeper-probe.mjs` (CLI), the zk-verify
 * GitHub Action, and the vitest gatekeeper suite.
 *
 * Trust model:
 *  - The verification (trusted) Ed25519 public key is supplied by the caller
 *    from outside the PR-controlled path (repo secret) — never derived inside
 *    a gate job.
 *  - Artifact binding: the envelope must carry `artifactHash` = sha256 of the
 *    canonical artifact bundle (r1cs, wasm, zkey, vk) of the EXACT compiled
 *    artifact being deployed; the gate recomputes the bundle digest from the
 *    on-disk artifacts and from the certified circuit-lib manifest, and
 *    rejects any mismatch.
 *  - On-chain enforcement: when `registry` options are supplied, the gate
 *    verifies the live registry state (registered / unexpired / unrevoked /
 *    correct circuit + public-input anchor) instead of trusting local state.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getCircuitDefinition, loadManifest, computeVkHash } from '@zkpe/circuit-lib';
import { canonicalize, proofAnchorFromEnvelope, publicInputHash, validateEnvelope } from '@zkpe/proof-format';
import { verifyEnvelope } from '@zkpe/keys';
import { verify as engineVerify, Circuit } from '@zkpe/engine';

export const GATEKEEPER_SCHEMA_VERSION = 1;

export function canonicalArtifactBundle(r1cs, wasm, zkey, vkSha256, vkHash) {
  return canonicalize({ r1cs, wasm, zkey, vk: { sha256: vkSha256, vkHash } });
}

export function sha256Hex(input) {
  return `0x${createHash('sha256').update(input, 'utf8').digest('hex')}`;
}

/**
 * Compute the artifact bundle sha256 from a manifest's artifact section.
 */
export function artifactHashFromManifest(manifest) {
  return sha256Hex(
    canonicalArtifactBundle(
      manifest.artifacts.r1cs,
      manifest.artifacts.wasm,
      manifest.artifacts.zkey,
      manifest.artifacts.vk.sha256,
      manifest.artifacts.vk.vkHash,
    ),
  );
}

/**
 * Run the gate. `deps` allows tests to inject implementations.
 *
 * @param {object} opts
 * @param {string} opts.envelopeFile       path to the proof envelope JSON
 * @param {string} [opts.trustedPublicKey] Ed25519 public JWK (JSON string)
 * @param {boolean} [opts.requireSigned]
 * @param {string} [opts.circuit]          required circuitId
 * @param {string} [opts.vkAllowlist]      "circuitId=0xvkHash;..." entries
 * @param {string} [opts.artifactDir]      dir containing the deployed artifact
 * @param {boolean} [opts.requireArtifactHash] require envelope.artifactHash
 * @param {object} [opts.registry]         { rpcUrl, proxy, maxAge } for on-chain check
 * @param {object} [deps]                  { readFile, readDirArtifacts, chainCall, engineVerify }
 * @returns {Promise<{verified: boolean, reasons: string[], report: object}>}
 */
export async function runGate(opts, deps = {}) {
  const reasons = [];
  const report = {
    schemaVersion: GATEKEEPER_SCHEMA_VERSION,
    circuitId: null,
    vkHash: null,
    artifactHash: null,
    publicInputHash: null,
    keyId: null,
    onChain: null,
    checks: [],
    verified: false,
    reasons,
  };
  const check = (name, ok, detail = '') => {
    report.checks.push({ name, ok: Boolean(ok), detail });
    if (!ok) reasons.push(`${name}: ${detail}`);
    return Boolean(ok);
  };

  const readFileFn = deps.readFile ?? readFile;

  // 0. envelope shape + proofHash
  let envelope;
  try {
    envelope = JSON.parse(await readFileFn(resolve(process.cwd(), opts.envelopeFile), 'utf8'));
  } catch (err) {
    reasons.push(`envelope unreadable: ${err.message}`);
    return finalize(report);
  }
  const shape = validateEnvelope(envelope);
  check('envelope-shape', shape.length === 0, shape.join('; ') || 'valid');

  // 1. required circuit
  const circuitId = envelope.circuitId;
  report.circuitId = circuitId;
  if (opts.circuit && opts.circuit !== circuitId) {
    check('circuit-match', false, `gate requires '${opts.circuit}', envelope says '${circuitId}'`);
  } else {
    check('circuit-match', true);
  }

  // 2. certified circuit + vkHash allow-list
  let manifest = null;
  try {
    const def = getCircuitDefinition(circuitId);
    manifest = (deps.loadManifest ?? loadManifest)(def);
  } catch (err) {
    check('certified-circuit', false, `unknown/uncertified circuit '${circuitId}': ${err.message}`);
  }
  report.vkHash = envelope.vkHash ?? null;
  if (manifest) {
    const certifiedVk = manifest.artifacts.vk.vkHash;
    const vkOk = envelope.vkHash != null && envelope.vkHash.toLowerCase() === certifiedVk.toLowerCase();
    check('vk-certified', vkOk, vkOk ? 'matches certified vkHash' : `envelope ${envelope.vkHash ?? '(none)'} != certified ${certifiedVk}`);
  }
  if (opts.vkAllowlist) {
    const allow = parseAllowlist(opts.vkAllowlist);
    const want = allow[circuitId];
    if (want) {
      check(
        'vk-allowlist',
        envelope.vkHash != null && envelope.vkHash.toLowerCase() === want.toLowerCase(),
        `envelope vkHash ${envelope.vkHash ?? '(none)'} not in allow-list (${want})`,
      );
    }
  }

  // 3. artifact binding — envelope artifactHash vs certified manifest bundle
  if (manifest) {
    const fromManifest = artifactHashFromManifest(manifest);
    report.artifactHash = envelope.artifactHash ?? null;
    const bound = envelope.artifactHash != null && envelope.artifactHash.toLowerCase() === fromManifest.toLowerCase();
    if (opts.requireArtifactHash !== false) {
      check('artifact-bound', bound, bound ? 'matches certified bundle' : `envelope ${envelope.artifactHash ?? '(none)'} != certified bundle ${fromManifest}`);
    }
  }

  // 4. on-disk artifact digest matches the certified manifest (deployed artifact)
  if (opts.artifactDir && manifest) {
    const disk = await (deps.readDirArtifacts ?? readDirArtifacts)(circuitId, opts.artifactDir);
    if (disk) {
      const diskBundle = sha256Hex(canonicalArtifactBundle(disk.r1cs, disk.wasm, disk.zkey, disk.vkSha256, disk.vkHash));
      const diskOk =
        disk.r1cs === manifest.artifacts.r1cs &&
        disk.wasm === manifest.artifacts.wasm &&
        disk.zkey === manifest.artifacts.zkey &&
        disk.vkSha256 === manifest.artifacts.vk.sha256;
      check('artifact-disk', diskOk, diskOk ? 'on-disk artifacts match manifest' : `on-disk artifacts differ (bundle ${diskBundle})`);
    } else {
      check('artifact-disk', false, `no artifacts found in ${opts.artifactDir}`);
    }
  }

  // 5. cryptographic proof verification against the certified vk
  try {
    const circuit = await (deps.loadCircuit ?? Circuit.load)(circuitId);
    const { valid } = await (deps.engineVerify ?? engineVerify)(circuit, envelope.publicInputs, envelope.proof);
    check('proof-valid', valid, 'engine verification rejected the proof');
  } catch (err) {
    check('proof-valid', false, `engine verification threw: ${err.message}`);
  }

  // 6. signature — trusted key only
  let sigOk = false;
  if (opts.trustedPublicKey) {
    const sigReasons = verifyEnvelope(
      envelope,
      { publicJwk: JSON.parse(opts.trustedPublicKey) },
      { requireSigned: opts.requireSigned ?? true },
    );
    sigOk = sigReasons.length === 0;
    check('signature', sigOk, sigReasons.join('; ') || 'valid');
    if (sigOk) report.keyId = envelope.signature?.keyId ?? null;
  } else {
    check('signature', false, 'no trusted verification key supplied (gate is fail-closed)');
  }

  // 7. on-chain enforcement
  if (opts.registry) {
    const chain = await (deps.chainCheck ?? checkChain)(circuitId, envelope, opts.registry, report);
    if (chain) {
      for (const c of chain) {
        check(c.name, c.ok, c.detail);
      }
    } else {
      check('on-chain', false, 'chain check failed unexpectedly');
    }
  } else {
    check('on-chain', true, 'skipped (no registry configured)');
  }

  return finalize(report);
}

function finalize(report) {
  report.verified = report.reasons.length === 0;
  return { verified: report.verified, reasons: report.reasons, report };
}

function parseAllowlist(raw) {
  const out = {};
  for (const pair of String(raw).split(/[;,]/)) {
    const idx = pair.indexOf('=');
    if (idx <= 0) throw new Error(`bad allowlist entry '${pair}'`);
    out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim().toLowerCase();
  }
  return out;
}

/**
 * Read artifact digests from a deployed artifact directory. Layout expected:
 * `<dir>/<circuitId>.r1cs`, `<dir>/<circuitId>_js/<circuitId>.wasm`,
 * `<dir>/<circuitId>.zkey`, `<dir>/<circuitId>.vkey.json`.
 */
async function readDirArtifacts(circuitId, dir) {
  try {
    const [r1cs, wasm, zkey, vkRaw] = await Promise.all([
      sha256File(resolve(dir, `${circuitId}.r1cs`)),
      sha256File(resolve(dir, `${circuitId}_js`, `${circuitId}.wasm`)),
      sha256File(resolve(dir, `${circuitId}.zkey`)),
      readFile(resolve(dir, `${circuitId}.vkey.json`), 'utf8'),
    ]);
    const vkJson = JSON.parse(vkRaw);
    return {
      r1cs,
      wasm,
      zkey,
      vkSha256: `0x${createHash('sha256').update(vkRaw).digest('hex')}`,
      vkHash: computeVkHash(vkJson),
    };
  } catch {
    return null;
  }
}

function sha256File(path) {
  return readFile(path).then((b) => `0x${createHash('sha256').update(b).digest('hex')}`);
}

/**
 * Live registry check via JSON-RPC eth_call. Verifies:
 *  - the circuit is registered and active, with vkHash == envelope vkHash
 *  - the anchor publicInputHash is Proved (not unregistered, not revoked)
 *  - requireProved(circuitId, anchor, maxAge) does not revert (expiry)
 */
export async function checkChain(circuitId, envelope, registry, report) {
  const { rpcUrl, proxy, maxAge = 0 } = registry;
  const anchor = publicInputHash(envelope.publicInputs);
  report.publicInputHash = anchor;
  const out = [];
  const rpc = async (method, params) => {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    return json.result;
  };

  const pad = (hex) => `0x${hex.replace(/^0x/, '').padStart(64, '0')}`;
  const padLeft = (hex) => `0x${hex.replace(/^0x/, '').padEnd(64, '0')}`;
  const circuitId32 = padLeft(Buffer.from(circuitId, 'utf8').toString('hex'));
  const enc = (n) => pad(typeof n === 'bigint' || typeof n === 'number' ? n.toString(16) : n);

  // circuits(bytes32) -> (address verifier, bytes32 vkHash, bool active)
  const sel = '0xaffeceb6';
  try {
    const raw = await rpc('eth_call', [{ to: proxy, data: `${sel}${circuitId32.slice(2)}` }, 'latest']);
    const verifier = `0x${raw.slice(26, 66)}`;
    const vkOnChain = `0x${raw.slice(66, 130)}`;
    const active = raw.slice(130, 194) === '0'.repeat(63) + '1';
    const registered = verifier !== '0x'.padEnd(42, '0');
    out.push({
      name: 'on-chain-circuit',
      ok: registered && active,
      detail: registered && active
        ? `circuit registered + active`
        : `circuit ${registered ? 'registered but inactive' : 'not registered'} (verifier ${verifier})`,
    });
    out.push({
      name: 'on-chain-vk',
      ok: vkOnChain === (envelope.vkHash ?? '').toLowerCase(),
      detail: `on-chain vkHash ${vkOnChain} vs envelope ${envelope.vkHash ?? '(none)'}`,
    });
  } catch (err) {
    out.push({ name: 'on-chain-circuit', ok: false, detail: `eth_call circuits failed: ${err.message}` });
    return out;
  }

  // getProofStatus(bytes32, bytes32) -> (uint8 status, uint256 provedAt)
  const sel2 = '0xcf37b4c2';
  const data2 = `${sel2}${circuitId32.slice(2)}${enc(anchor).slice(2)}`;
  try {
    const raw = await rpc('eth_call', [{ to: proxy, data: data2 }, 'latest']);
    const status = parseInt(raw.slice(2, 66), 16);
    const provedAt = BigInt(`0x${raw.slice(66)}`);
    out.push({
      name: 'on-chain-status',
      ok: status === 1,
      detail:
        status === 1 ? `proved since block ${provedAt.toString()}` : status === 2 ? 'revoked' : 'unregistered',
    });
  } catch (err) {
    out.push({ name: 'on-chain-status', ok: false, detail: `eth_call getProofStatus failed: ${err.message}` });
    return out;
  }

  // proofLeaves(bytes32) — EXACT binding: the very anchor
  // keccak256(abi.encode(circuitId, vkHash, publicInputs, a, b, c)) that
  // ZKVerifierRegistry.registerProof stored must exist as a leaf. A
  // registered claim with a different (or swapped) proof object never
  // satisfies this, even when status on the claim anchor says Proved.
  const leafHash = proofAnchorFromEnvelope(
    circuitId,
    envelope.vkHash ?? '',
    envelope.publicInputs,
    envelope.proof,
  );
  const selLeaf = '0x43e3147e';
  const dataLeaf = `${selLeaf}${leafHash.slice(2)}`;
  try {
    const raw = await rpc('eth_call', [{ to: proxy, data: dataLeaf }, 'latest']);
    const leaf = raw.slice(2, 66) === '0'.repeat(63) + '1';
    out.push({
      name: 'on-chain-proof',
      ok: leaf,
      detail: leaf
        ? `exact proof leaf registered (${leafHash})`
        : `proof NOT exactly anchored on-chain (${leafHash})`,
    });
  } catch (err) {
    out.push({ name: 'on-chain-proof', ok: false, detail: `eth_call proofLeaves failed: ${err.message}` });
  }

  // requireProved(bytes32, bytes32, uint256) — revert means expired/not proved
  const sel3 = '0x88d5cfd7';
  const data3 = `${sel3}${circuitId32.slice(2)}${enc(anchor).slice(2)}${enc(maxAge).slice(2)}`;
  try {
    await rpc('eth_call', [{ to: proxy, data: data3 }, 'latest']);
    out.push({ name: 'on-chain-requireProved', ok: true, detail: `unexpired (maxAge ${maxAge})` });
  } catch (err) {
    out.push({
      name: 'on-chain-requireProved',
      ok: false,
      detail: `revert: ${String(err.message).slice(0, 160)}`,
    });
  }
  return out;
}
