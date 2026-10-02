/**
 * Fastify assembly — hooks, auth, rate limiting, routes, problem+json errors,
 * OpenAPI (§1–§14). All cryptographic verification and hashing stay behind the
 * engine / proof-format / registry ports; this layer only orchestrates.
 *
 * Single decision points (as required by the design review):
 *  - auth:       application/auth.ts  (canonical HMAC + nonce)
 *  - RBAC:       application/auth.ts  (assertRole)
 *  - rate limit: application/rateLimit.ts (token bucket per client, stricter
 *                bucket for CPU-bound verify work)
 *  - errors:     domain/errors.ts → RFC 9457 problem+json, always
 */

import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import Swagger, { type SwaggerOptions } from '@fastify/swagger';
import type { Config } from '../config.js';
import type { ApiPrincipal, ProofSubmission } from '../domain/entities.js';
import { DomainError, validationProblem } from '../domain/errors.js';
import type {
  AuditSinkPort,
  ClockPort,
  EnginePort,
  IdempotencyStorePort,
  MetricsSinkPort,
  NonceStorePort,
  SecretStorePort,
  TracerPort,
} from '../domain/ports.js';
import { Authenticator, assertRole } from '../application/auth.js';
import { RateLimiter, TokenBucket } from '../application/rateLimit.js';
import { IdempotencyPolicy } from '../application/idempotency.js';
import type { RegistryReadPort, RegistryWritePort } from '../domain/ports.js';
import { VerifyProofUseCase } from '../application/useCases/verifyProof.js';
import { RegisterProofUseCase } from '../application/useCases/registerProof.js';
import { ProofStatusUseCase } from '../application/useCases/proofStatus.js';
import { ListCircuitsUseCase } from '../application/useCases/listCircuits.js';
import { RegistryInfoUseCase } from '../application/useCases/registryInfo.js';
import { AuditListUseCase } from '../application/useCases/auditList.js';
import {
  proofSubmission as proofSubmissionJson,
  verifyResponse as verifyResponseJson,
  registerResponse as registerResponseJson,
  statusParams as statusParamsJson,
  statusResponse as statusResponseJson,
  registryInfoResponse as registryInfoResponseJson,
  circuitListResponse as circuitListResponseJson,
  auditListResponse as auditListResponseJson,
} from './openapi.js';
import { proofSubmissionSchema } from './schemas.js';

export interface ServerDeps {
  config: Config;
  engine: EnginePort;
  registryRead: RegistryReadPort | null;
  registryWrite: RegistryWritePort | null;
  secrets: SecretStorePort;
  nonces: NonceStorePort;
  idempotencyStore: IdempotencyStorePort;
  audit: AuditSinkPort;
  metrics: MetricsSinkPort;
  clock: ClockPort;
  tracer: TracerPort;
}

interface ZkRequestContext {
  requestId: string;
  principal: ApiPrincipal | null;
  span: ReturnType<TracerPort['startSpan']>;
}

declare module 'fastify' {
  interface FastifyRequest {
    zk?: ZkRequestContext;
  }
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: deps.config.logLevel },
    genReqId: (req) => {
      const declared = req.headers['x-request-id'];
      if (typeof declared === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(declared)) return declared;
      return randomUUID();
    },
    bodyLimit: deps.config.maxPayloadBytes,
  });

  // ---------- OpenAPI 3.1 ----------
  await app.register(
    Swagger,
    {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'zkp-engine API',
          version: process.env.ZK_API_VERSION ?? '0.2.0',
          description: 'Proof submission and status API — HMAC-authenticated',
        },
        components: {
          securitySchemes: {
            apiKey: { type: 'apiKey', name: 'x-zk-key', in: 'header' },
          },
        },
      },
      routePrefix: '/v1',
      hideUntagged: false,
      exposeRoute: false,
    } as SwaggerOptions,
  );

  const serveSpec = (_req: FastifyRequest, reply: FastifyReply): string => {
    const doc = app.swagger() as { openapi: string | undefined };
    doc.openapi = '3.1.0';
    reply.type('application/json');
    return JSON.stringify(doc, null, 2);
  };
  app.get('/v1/docs', { schema: { description: 'OpenAPI 3.1 (JSON)' } }, serveSpec);
  app.get('/v1/openapi.json', { schema: { description: 'OpenAPI 3.1 (JSON)' } }, serveSpec);

  // ---------- security (single decision point) ----------
  const authenticator = new Authenticator(deps.secrets, deps.nonces, deps.clock, deps.config.authTtlSeconds * 1000);
  const rateLimiter = new RateLimiter(
    new TokenBucket({
      capacity: deps.config.rateCapacity,
      refillPerWindow: deps.config.rateRefillPerMinute,
      windowMs: 60_000,
    }),
    new TokenBucket({
      capacity: deps.config.rateVerifyCapacity,
      refillPerWindow: deps.config.rateVerifyRefillPerMinute,
      windowMs: 60_000,
    }),
  );

  // ---------- tracing: one http.request root span per request ----------
  app.addHook('onRequest', async (req) => {
    const span = deps.tracer.startSpan('http.request', {
      'http.request.method': req.method,
      'url.path': req.url.split('?')[0] ?? '',
      'request.id': req.id,
    });
    req.zk = { requestId: req.id, principal: null, span };
  });
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
  app.addHook('onResponse', async (req, reply) => {
    const ctx = req.zk;
    if (ctx) {
      ctx.span.setAttributes({ 'http.response.status_code': reply.statusCode });
      ctx.span.ok(reply.statusCode < 400 ? 'ok' : 'error');
      ctx.span.end();
    }
    deps.metrics
      .inc('http_requests_total', 1, { method: req.method, status: String(reply.statusCode) });
    deps.metrics.duration('http_request_duration_ms', reply.elapsedTime);
  });

  async function authorize(req: FastifyRequest, roles: string[], verifyCost: boolean): Promise<void> {
    const principal = await authenticator.authenticate({
      method: req.method,
      path: req.url.split('?')[0]!,
      query: req.url.split('?')[1] ?? '',
      headers: req.headers as Record<string, string | string[] | undefined>,
      bodyJson: req.body ?? null,
    });
    const lim = rateLimiter.check(principal.clientId, verifyCost);
    if (!lim.allowed) {
      await deps.audit.append({
        id: `aud_${randomUUID().slice(0, 8)}`,
        at: new Date().toISOString(),
        actor: principal.clientId,
        tenantId: principal.tenantId,
        action: 'ratelimit.enforced',
        resource: req.url,
        outcome: 'denied',
        detail: { retryAfterMs: lim.retryAfterMs },
        requestId: req.id,
      });
      throw new DomainError('RATE-LIMITED', { detail: `retry after ${Math.ceil(lim.retryAfterMs / 1000)}s` });
    }
    assertRole(principal, roles);
    if (req.zk) {
      req.zk.principal = principal;
      req.zk.span.setAttributes({ 'client.id': principal.clientId });
    }
  }

  const guard =
    (roles: string[], verifyCost = false) =>
    async (req: FastifyRequest): Promise<void> =>
      authorize(req, roles, verifyCost);

  const execCtx = (req: FastifyRequest) => ({
    requestId: req.id,
    actor: req.zk?.principal?.clientId ?? 'anonymous',
    tenantId: req.zk?.principal?.tenantId ?? 'anonymous',
    ip: req.ip,
  });

  // ---------- use cases ----------
  const verifyUseCase = new VerifyProofUseCase({
    engine: deps.engine,
    audit: deps.audit,
    metrics: deps.metrics,
    tracer: deps.tracer,
  });
  const registerUseCase = deps.registryRead && deps.registryWrite
    ? new RegisterProofUseCase({
        engine: deps.engine,
        registryRead: deps.registryRead,
        registryWrite: deps.registryWrite,
        audit: deps.audit,
        metrics: deps.metrics,
        tracer: deps.tracer,
      })
    : null;
  const statusUseCase = deps.registryRead
    ? new ProofStatusUseCase({
        registry: deps.registryRead,
        audit: deps.audit,
        metrics: deps.metrics,
        tracer: deps.tracer,
      })
    : null;
  const listUseCase = new ListCircuitsUseCase({ engine: deps.engine, registry: deps.registryRead, audit: deps.audit });
  const registryInfoUseCase = deps.registryRead
    ? new RegistryInfoUseCase({
        registry: deps.registryRead,
        audit: deps.audit,
        metrics: deps.metrics,
        tracer: deps.tracer,
      })
    : null;
  const auditUseCase = new AuditListUseCase({ audit: deps.audit });

  // ---------- routes ----------
  app.get('/v1/health', { schema: { description: 'Liveness probe' } }, async () => ({ status: 'ok' }));

  app.get(
    '/v1/ready',
    { schema: { description: 'Readiness probe' } },
    async () => {
      const engineOk = await deps.engine.healthy();
      const registryState = deps.registryRead ? await deps.registryRead.healthy() : 'not-configured';
      const ready = engineOk && (registryState === true || registryState === 'not-configured');
      return { status: ready ? 'ok' : 'degraded', components: { engine: engineOk, registry: String(registryState) } };
    },
  );

  app.get('/v1/metrics', { schema: { description: 'Prometheus text format (public)' } }, async (_req, reply) => {
    reply.type('text/plain; version=0.0.4');
    return deps.metrics.render();
  });

  app.get(
    '/v1/circuits',
    {
      preHandler: [guard(['read'])],
      schema: { description: 'Certified circuit catalog', response: { 200: circuitListResponseJson } },
    },
    async (req) => listUseCase.list(execCtx(req)),
  );

  app.get(
    '/v1/proofs/status/:circuitId/:publicInputHash',
    {
      preHandler: [guard(['read'])],
      schema: { description: 'On-chain status', params: statusParamsJson, response: { 200: statusResponseJson } },
    },
    async (req) => {
      if (!statusUseCase) throw new DomainError('OUT-OF-SERVICE', { detail: 'registry not configured' });
      const { circuitId, publicInputHash } = req.params as { circuitId: string; publicInputHash: string };
      return statusUseCase.status(circuitId, publicInputHash, execCtx(req));
    },
  );

  app.post(
    '/v1/proofs/verify',
    {
      preHandler: [guard(['submit'], true)],
      schema: {
        description: 'Verify locally — returns anchor when true (428 otherwise)',
        body: proofSubmissionJson,
        response: { 200: verifyResponseJson, 428: { type: 'object' } },
      },
    },
    async (req) => {
      const submission = parseSubmission(req.body);
      return verifyUseCase.execute(submission, execCtx(req));
    },
  );

  app.post(
    '/v1/proofs/register',
    {
      preHandler: [guard(['write'], true)],
      schema: {
        description: 'Verify then anchor on-chain — requires Idempotency-Key',
        body: proofSubmissionJson,
        response: { 200: registerResponseJson, 428: { type: 'object' } },
      },
    },
    async (req) => {
      if (!registerUseCase) throw new DomainError('OUT-OF-SERVICE', { detail: 'registry write not configured' });
      const idemKey = req.headers['idempotency-key'];
      if (typeof idemKey !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(idemKey)) {
        throw new DomainError('VALIDATION', { detail: 'missing or malformed Idempotency-Key header' });
      }
      const submission = parseSubmission(req.body);
      const policy = new IdempotencyPolicy(deps.idempotencyStore, deps.config.idempotencyTtlMs);
      const keyHash = policy.keyHash(idemKey);
      const payloadHash = policy.payloadHash(submission);
      return policy.exclusive(keyHash, async () => {
        const replay = await policy.replay(keyHash, payloadHash);
        if (replay) return replay.result;
        const result = await registerUseCase.register(submission, execCtx(req));
        const response = { verified: true, ...result };
        await policy.store(keyHash, payloadHash, response);
        return response;
      });
    },
  );

  app.get(
    '/v1/registry',
    {
      preHandler: [guard(['read'])],
      schema: { description: 'Registry overview', response: { 200: registryInfoResponseJson } },
    },
    async (req) => {
      if (!registryInfoUseCase) throw new DomainError('OUT-OF-SERVICE', { detail: 'registry not configured' });
      const circuits = await deps.engine.listCircuits();
      return registryInfoUseCase.info(circuits.map((c) => c.circuitId), execCtx(req));
    },
  );

  app.get(
    '/v1/audit',
    {
      preHandler: [guard(['audit'])],
      schema: {
        description: 'Audit log (audit role)',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 1000, default: 50 },
            action: { type: 'string' },
          },
        },
        response: { 200: auditListResponseJson },
      },
    },
    async (req) => {
      const query = req.query as { limit?: number; action?: string };
      return auditUseCase.list(query.limit ?? 50, (query.action as import('../domain/entities.js').AuditAction) ?? undefined, execCtx(req));
    },
  );

  // ---------- errors → RFC 9457 problem+json ----------
  app.setErrorHandler((err, req, reply) => {
    const instance = req.url;
    const requestId = req.id;
    if (err instanceof DomainError) {
      reply.code(err.status).header('content-type', 'application/problem+json');
      return reply.send(err.toProblem(instance, requestId));
    }
    if (err && typeof err === 'object' && 'validation' in err) {
      const issues = (((err as { validation?: unknown }).validation ?? []) as { instancePath?: string; message?: string }[]).map(
        (v) => ({ path: v.instancePath ?? req.url, message: v.message ?? 'validation failed' }),
      );
      const problem = validationProblem(issues);
      reply.code(problem.status).header('content-type', 'application/problem+json');
      return reply.send(problem.toProblem(instance, requestId));
    }
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code?.startsWith('FST_ERR_CTP_')) {
      const code = (err as { code?: string }).code;
      const problem = new DomainError(
        code === 'FST_ERR_CTP_BODY_TOO_LARGE'
          ? 'PAYLOAD-TOO-LARGE'
          : code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
            ? 'UNSUPPORTED-MEDIA-TYPE'
            : 'MALFORMED-BODY',
      );
      reply.code(problem.status).header('content-type', 'application/problem+json');
      return reply.send(problem.toProblem(instance, requestId));
    }
    req.log.error({ err }, 'unhandled error');
    const problem = new DomainError('INTERNAL');
    reply.code(problem.status).header('content-type', 'application/problem+json');
    return reply.send(problem.toProblem(instance, requestId));
  });

  return app;
}

function parseSubmission(body: unknown): ProofSubmission {
  const parsed = proofSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    throw validationProblem(
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      'body failed application-level validation',
    );
  }
  return parsed.data;
}