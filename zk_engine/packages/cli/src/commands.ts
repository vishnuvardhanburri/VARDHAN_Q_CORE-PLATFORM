/**
 * `zk` command implementations (M6 surface: new/prove/verify/register/
 * status/registry/deploy/env). Thin orchestrators: engine + proof-format do
 * all crypto; @zkpe/api's shared client does all API auth; foundry scripts
 * do contract deployment. This package adds no crypto material of its own.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCircuitDefinition, computeArtifactBundleHash } from '@zkpe/circuit-lib';
import { Circuit, prove as engineProve, verify as engineVerify } from '@zkpe/engine';
import { createEnvelope, publicInputHash, type ProofEnvelope, type Groth16Proof } from '@zkpe/proof-format';
import type { ApiClient } from '@zkpe/api';
import { ProfileStore } from './env.js';
import { readEnvelopeFile, writeEnvelopeFile } from './envelope.js';

export interface CliCtx {
  env: string;
  cwd: string;
  store: ProfileStore;
}

// ---------------------------------------------------------------------------
// zk new — scaffold a circuit project (inputs template)
// ---------------------------------------------------------------------------

export async function cmdNew(ctx: CliCtx, circuitId: string, dir: string): Promise<{ dir: string; circuitId: string; inputsFile: string }> {
  const def = getCircuitDefinition(circuitId);
  const target = resolve(ctx.cwd, dir);
  await mkdir(target, { recursive: true });
  const template = buildInputTemplate(def.privateInputs.map((i) => ({ id: i.id, type: i.type, arity: i.arity })));
  const inputsFile = join(target, 'inputs.json');
  await writeFile(inputsFile, JSON.stringify(template, null, 2) + '\n');
  return { dir: target, circuitId: def.id, inputsFile };
}

/** Input template from a circuit's private-input schema. */
export function buildInputTemplate(inputs: { id: string; type: string; arity: number | string }[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const input of inputs) {
    const arity = typeof input.arity === 'number' ? input.arity : 1;
    out[input.id] = input.type === 'u1' ? Array.from({ length: arity }, () => 1) : Array.from({ length: arity }, () => '0');
  }
  return out;
}

// ---------------------------------------------------------------------------
// zk prove — locally produce a certified-circuit proof envelope
// ---------------------------------------------------------------------------

export interface ProveArgs {
  circuitId: string;
  inputsFile: string;
  outFile: string;
}

export async function cmdProve(ctx: CliCtx, a: ProveArgs) {
  const circuit = await Circuit.load(a.circuitId);
  const raw = await readFile(resolve(ctx.cwd, a.inputsFile), 'utf8');
  const inputs = JSON.parse(raw) as Record<string, unknown>;
  const { proof, publicSignals, task } = await engineProve(circuit, inputs);
  const envelope: ProofEnvelope = createEnvelope({
    circuitId: a.circuitId,
    circuitVersion: circuit.def.version,
    vkHash: circuit.manifest.artifacts.vk.vkHash,
    artifactHash: await computeArtifactBundleHash(circuit.def),
    publicInputs: publicSignals,
    proof,
    proverTimestamp: Date.now(),
  });
  const outPath = resolve(ctx.cwd, a.outFile);
  await writeEnvelopeFile(outPath, envelope);
  return {
    out: outPath,
    proofHash: publicInputHash(publicSignals),
    circuitId: a.circuitId,
    vkHash: circuit.manifest.artifacts.vk.vkHash,
    task: { status: task.status },
  };
}

// ---------------------------------------------------------------------------
// zk verify — verify an envelope locally (engine), optionally on API too
// ---------------------------------------------------------------------------

export interface VerifyArgs {
  proofFile: string;
  client?: ApiClient;
  offline?: boolean;
}

export async function cmdVerify(ctx: CliCtx, a: VerifyArgs) {
  const envelope = await readEnvelopeFile(resolve(ctx.cwd, a.proofFile));
  const circuit = await Circuit.load(envelope.circuitId);
  const { valid } = await engineVerify(circuit, envelope.publicInputs, envelope.proof as unknown as Groth16Proof);
  if (!valid) return { valid: false, circuitId: envelope.circuitId };
  if (a.offline === true || !a.client) return { valid: true, circuitId: envelope.circuitId };
  const apiResult = (await a.client.verifyProof({
    circuitId: envelope.circuitId,
    proof: envelope.proof,
    publicInputs: envelope.publicInputs,
  })) as { verified: boolean };
  return { valid: true, circuitId: envelope.circuitId, api: apiResult };
}

// ---------------------------------------------------------------------------
// zk register — anchor an envelope's proof on-chain via the API
// ---------------------------------------------------------------------------

export interface RegisterArgs {
  proofFile: string;
  idempotencyKey: string;
  client: ApiClient;
}

export async function cmdRegister(ctx: CliCtx, a: RegisterArgs) {
  const envelope = await readEnvelopeFile(resolve(ctx.cwd, a.proofFile));
  const result = (await a.client.registerProof(
    { circuitId: envelope.circuitId, proof: envelope.proof, publicInputs: envelope.publicInputs },
    a.idempotencyKey,
  )) as { verified: boolean; publicInputHash: string; txHash: string };
  return { txHash: result.txHash, publicInputHash: result.publicInputHash };
}

// ---------------------------------------------------------------------------
// zk status — on-chain proof status via the API
// ---------------------------------------------------------------------------

export interface StatusArgs {
  proofFile: string;
  circuitId?: string;
  publicInputHash?: string;
  client: ApiClient;
}

export async function cmdStatus(ctx: CliCtx, a: StatusArgs) {
  const envelope = await readEnvelopeFile(resolve(ctx.cwd, a.proofFile));
  const hash = a.publicInputHash ?? publicInputHash(envelope.publicInputs);
  const circuitId = a.circuitId ?? envelope.circuitId;
  const body = (await a.client.proofStatus(circuitId, hash)) as { status: string; provedAt: string };
  return { circuitId, publicInputHash: hash, ...body };
}

// ---------------------------------------------------------------------------
// zk registry — read registry state via the API
// ---------------------------------------------------------------------------

export async function cmdRegistry(client: ApiClient) {
  return (await client.registryInfo()) as {
    proxy: string;
    schemaVersion: string;
    totalProofs: string;
    paused: boolean;
    circuits: Record<string, { verifier: string; vkHash: string; active: boolean }>;
  };
}

// ---------------------------------------------------------------------------
// zk deploy — registry deploy to the target env via foundry scripts.
// Orchestrates `forge script script/Deploy.s.sol` against dev anvil; records
// the deployed proxy into the profile. (Prod path is the ops runbook.)
// ---------------------------------------------------------------------------

export interface LoadedDeployment {
  registryProxy: string;
  transactions: unknown[];
}

/** Post-process forge broadcast JSON for Deploy.s.sol into addresses. */
export function parseDeployBroadcast(raw: string): LoadedDeployment {
  const broadcast = JSON.parse(raw) as { transactions?: { contractName?: string; contractAddress?: string }[] };
  const txs = broadcast.transactions ?? [];
  const proxyTx = txs.filter((t) => t.contractName === 'ERC1967Proxy');
  const registryTx = txs.find((t) => t.contractName === 'ERC1967Proxy');
  if (!proxyTx.length || !registryTx) {
    throw new Error('deploy broadcast did not contain an ERC1967Proxy transaction — did forge script --broadcast run?');
  }
  const proxy = proxyTx[0] as { contractAddress?: string };
  if (!proxy.contractAddress) {
    throw new Error('deploy broadcast missing contractAddress for the registry proxy');
  }
  return { registryProxy: proxy.contractAddress, transactions: txs };
}

export interface DeployArgs {
  env: string;
  rpcUrl: string;
  forgeBin?: string;
  contractsDir?: string;
}

export async function cmdDeploy(ctx: CliCtx, a: DeployArgs, run: typeof spawnSync = spawnSync) {
  const cmd = [a.forgeBin ?? 'forge', 'script', 'script/Deploy.s.sol', '--rpc-url', a.rpcUrl, '--broadcast'];
  const result = run(cmd[0] ?? '', cmd.slice(1), { encoding: 'utf8', cwd: a.contractsDir, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`forge deploy failed (${result.stderr ?? result.stdout ?? 'no output'})`);
  }
  const parsed = parseDeployBroadcast(result.stdout);
  await ctx.store.save(a.env, { registryProxy: parsed.registryProxy });
  return parsed;
}

// ---------------------------------------------------------------------------
// zk auth — show/set the API profile (secrets redacted)
// ---------------------------------------------------------------------------

export async function cmdEnvShow(ctx: CliCtx, name?: string) {
  const env = name ?? ctx.env;
  if (!(await ctx.store.exists(env))) {
    throw new Error(`no profile for env "${env}" — run \`zk env set\``);
  }
  return ctx.store.redacted(env);
}

export async function cmdEnvSet(ctx: CliCtx, opts: { env: string; apiUrl: string; clientId: string; secret: string; create?: boolean }) {
  await ctx.store.save(opts.env, { apiUrl: opts.apiUrl, clientId: opts.clientId, secret: opts.secret }, opts.create ? { create: true } : {});
  return { env: opts.env, apiUrl: opts.apiUrl, clientId: opts.clientId, secret: '<redacted>' };
}