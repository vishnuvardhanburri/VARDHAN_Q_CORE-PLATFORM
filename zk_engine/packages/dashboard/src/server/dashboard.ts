/**
 * Dashboard server (M9) — Fastify BFF + static React shell.
 *
 * Security rules (docs/20):
 *  - API credentials + session secret live only here; the browser never
 *    sees them.
 *  - All /api routes are read-only passes over the M5 API (or local,
 *    pre-certified circuit-lib metadata / stored gatekeeper reports).
 *  - CSP + nosniff headers on every response.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyRateLimit from '@fastify/rate-limit';
import {
  artifactPaths,
  artifactsExist,
  computeArtifactBundleHash,
  getCircuitDefinition,
  loadManifest,
} from '@zkpe/circuit-lib';
import type { DashboardConfig } from './config.js';
import { ApiPortError, type DashboardApiPort } from './apiPort.js';
import type { GateReportStore } from './gateStore.js';
import { COOKIE_NAME, parseCookies, passwordMatches, signSession, verifySession } from './session.js';
import type { CircuitDetail, CircuitSummary } from '../shared/types.js';

export interface DashboardDeps {
  config: DashboardConfig;
  api: DashboardApiPort | null;
  gateReports: GateReportStore;
  /** Built web bundle dir (dist/web). When absent the UI route returns a stub. */
  webDir?: string;
  nowMs?: () => number;
}

const CIRCUIT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const HASH_RE = /^0x[0-9a-f]{64}$/;

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

export function buildDashboardServer(deps: DashboardDeps): FastifyInstance {
  const app = Fastify({ logger: false, disableRequestLogging: true });
  const nowMs = deps.nowMs ?? Date.now;

  app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: 60000
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', CSP);
    return payload;
  });

  const requireAuth = async (req: import('fastify').FastifyRequest, reply: FastifyReply) => {
    const token = parseCookies(req.headers.cookie).get(COOKIE_NAME);
    if (!verifySession(deps.config.sessionSecret, token, nowMs())) {
      return reply.code(401).send({ code: 'unauthorized', detail: 'login required' });
    }
  };

  // ---- public ----
  app.get('/api/health', async () => ({ ok: true }));

  app.post('/api/auth/login', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: 60000
      }
    }
  }, async (req, reply) => {
    const body = (req.body ?? {}) as { password?: unknown };
    if (typeof body.password !== 'string') {
      return reply.code(400).send({ code: 'bad_request', detail: 'password required' });
    }
    if (!passwordMatches(deps.config.password, body.password)) {
      return reply.code(401).send({ code: 'unauthorized', detail: 'invalid password' });
    }
    const expiresMs = nowMs() + deps.config.sessionTtlMs;
    const cookie = `${COOKIE_NAME}=${signSession(deps.config.sessionSecret, expiresMs)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(deps.config.sessionTtlMs / 1000)}${deps.config.secureCookies ? '; Secure' : ''}`;
    return reply.code(200).header('set-cookie', cookie).send({ ok: true, expiresMs });
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    return reply
      .code(200)
      .header('set-cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
      .send({ ok: true });
  });

  app.get('/api/auth/whoami', {
    config: {
      rateLimit: {
        max: 100,
        timeWindow: 60000
      }
    }
  }, async (req, reply) => {
    const session = verifySession(deps.config.sessionSecret, parseCookies(req.headers.cookie).get(COOKIE_NAME), nowMs());
    if (!session) return reply.code(401).send({ code: 'unauthorized', detail: 'login required' });
    return { ok: true, expiresMs: session.expiresMs };
  });

  const authConfig = {
    preHandler: requireAuth,
    config: { rateLimit: { max: 100, timeWindow: 60000 } }
  };

  // ---- authenticated read-only surface ----
  app.get('/api/registry', authConfig, async (_req, reply) => {
    if (!deps.api) return apiUnconfigured(reply);
    try {
      return await deps.api.registryInfo();
    } catch (err) {
      return apiProblem(reply, err);
    }
  });

  app.get('/api/circuits', authConfig, async (_req, reply) => {
    if (!deps.api) return apiUnconfigured(reply);
    let remote: { circuits: CircuitSummary[] };
    try {
      remote = await deps.api.listCircuits();
    } catch (err) {
      return apiProblem(reply, err);
    }
    const circuits: CircuitSummary[] = [];
    for (const c of remote.circuits) {
      circuits.push(await enrichCircuit(c));
    }
    return { circuits };
  });

  app.get('/api/circuits/:circuitId', authConfig, async (req, reply) => {
    const { circuitId } = req.params as { circuitId: string };
    if (!CIRCUIT_ID_RE.test(circuitId)) {
      return reply.code(400).send({ code: 'bad_request', detail: 'invalid circuitId' });
    }
    if (!deps.api) return apiUnconfigured(reply);
    let remote: { circuits: CircuitSummary[] };
    try {
      remote = await deps.api.listCircuits();
    } catch (err) {
      return apiProblem(reply, err);
    }
    const base = remote.circuits.find((c) => c.circuitId === circuitId);
    if (!base) return reply.code(404).send({ code: 'not_found', detail: 'unknown circuit' });
    return enrichCircuit(base);
  });

  app.get('/api/proofs/status/:circuitId/:publicInputHash', authConfig, async (req, reply) => {
    const { circuitId, publicInputHash } = req.params as { circuitId: string; publicInputHash: string };
    if (!CIRCUIT_ID_RE.test(circuitId) || !HASH_RE.test(publicInputHash)) {
      return reply.code(400).send({ code: 'bad_request', detail: 'invalid circuitId or publicInputHash' });
    }
    if (!deps.api) return apiUnconfigured(reply);
    try {
      return await deps.api.proofStatus(circuitId, publicInputHash);
    } catch (err) {
      return apiProblem(reply, err);
    }
  });

  app.get('/api/audit', authConfig, async (req, reply) => {
    if (!deps.api) return apiUnconfigured(reply);
    const raw = (req.query ?? {}) as { limit?: string };
    const limit = Math.min(1000, Math.max(1, Number(raw.limit ?? '50') || 50));
    try {
      return await deps.api.auditLogs(limit);
    } catch (err) {
      return apiProblem(reply, err);
    }
  });

  app.get('/api/gatekeeper', authConfig, async () => deps.gateReports.overview());

  app.get('/api/gatekeeper/report/:file', authConfig, async (req, reply) => {
    const { file } = req.params as { file: string };
    const detail = await deps.gateReports.readDetail(file);
    if (!detail) return reply.code(404).send({ code: 'not_found', detail: 'report not found' });
    return detail;
  });

  // ---- static shell + SPA fallback ----
  if (deps.webDir && existsSync(join(deps.webDir, 'index.html'))) {
    const webDir = resolve(deps.webDir);
    app.register(fastifyStatic, { root: webDir, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ code: 'not_found', detail: `no route ${req.url}` });
    });
  } else {
    app.get('/', async () => ({ ok: true, web: 'not-built' }));
  }

  return app;
}


function apiUnconfigured(reply: FastifyReply) {
  return reply.code(503).send({ code: 'api_unconfigured', detail: 'API credentials not configured' });
}

function apiProblem(reply: FastifyReply, err: unknown) {
  if (err instanceof ApiPortError && err.status > 0) {
    return reply.code(502).send({ code: `api_${err.code}`, detail: err.message });
  }
  return reply.code(502).send({ code: 'api_unreachable', detail: err instanceof Error ? err.message : String(err) });
}

/** Merge remote circuit summary with certified circuit-lib facts. */
async function enrichCircuit(base: CircuitSummary): Promise<CircuitSummary> {
  try {
    const def = getCircuitDefinition(base.circuitId);
    let manifest: ReturnType<typeof loadManifest> | null = null;
    try {
      manifest = loadManifest(def);
    } catch {
      manifest = null;
    }
    let artifactBundleHash: string | null = null;
    if (artifactsExist(def) && manifest) {
      artifactBundleHash = await computeArtifactBundleHash(def);
    }
    const detail: CircuitDetail = {
      ...base,
      manifest: manifest
        ? {
            vkHash: manifest.artifacts.vk.vkHash,
            artifactBundleHash: artifactBundleHash ?? 'unavailable',
            manifestHash: manifest.manifestHash,
            artifacts: {
              r1cs: manifest.artifacts.r1cs,
              wasm: manifest.artifacts.wasm,
              zkey: manifest.artifacts.zkey,
              vkSha256: manifest.artifacts.vk.sha256,
            },
          }
        : null,
      certified: manifest !== null,
      files: manifest ? fileExists(def) : null,
    };
    return detail;
  } catch {
    return base;
  }
}

function fileExists(def: ReturnType<typeof getCircuitDefinition>): CircuitDetail['files'] {
  const paths = artifactPaths(def);
  return {
    r1cs: existsSync(paths.r1cs),
    wasm: existsSync(paths.wasm),
    zkey: existsSync(paths.zkey),
    vkey: existsSync(paths.vk),
  };
}