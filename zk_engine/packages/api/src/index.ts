/**
 * Entrypoint — wires config → telemetry → adapters → buildServer → listen.
 * Fails fast on invalid config (before any listener binds).
 */

import { parseConfig, ConfigError } from './config.js';
import { initTelemetry, ApiTracer, NoopTracer, traceContextFromHeaders } from './telemetry/telemetry.js';
import { EnvSecretStore } from './infrastructure/auth/EnvSecretStore.js';
import { NonceStore } from './infrastructure/auth/NonceStore.js';
import { InMemoryIdempotencyStore } from './infrastructure/auth/IdempotencyStore.js';
import { RedisNonceStore } from './infrastructure/auth/RedisNonceStore.js';
import { RedisIdempotencyStore } from './infrastructure/auth/RedisIdempotencyStore.js';
import { Redis } from 'ioredis';
import { AuditLog } from './infrastructure/observability/AuditLog.js';
import { Metrics } from './infrastructure/observability/Metrics.js';
import { EngineAdapter } from './infrastructure/engine/EngineAdapter.js';
import { RegistryAdapter } from './infrastructure/contracts/RegistryAdapter.js';
import { buildServer } from './api/buildServer.js';

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const config = parseConfig(env);

  let redisClient: Redis | null = null;
  if (config.redisUrl) {
    redisClient = new Redis(config.redisUrl);
  }

  initTelemetry({
    serviceName: 'zkp-engine-api',
    serviceVersion: process.env.ZK_API_VERSION ?? '0.2.0',
    ...(config.otelEndpoint ? { endpoint: config.otelEndpoint } : {}),
    disabled: config.otelDisabled,
    samplerRatio: config.otelSamplerRatio,
  });
  const tracer = config.otelDisabled ? new NoopTracer() : new ApiTracer();

  const secrets = new EnvSecretStore(config.apiKeys.join(';'));
  const audit = new AuditLog(config.auditFile ? { filePath: config.auditFile } : {});
  const metrics = new Metrics();

  const engine = new EngineAdapter(tracer, metrics, config.maxConcurrentVerify);
  const registry = config.registryRpc
    ? new RegistryAdapter(
        {
          rpcUrl: config.registryRpc,
          ...(config.registryProxy ? { proxy: config.registryProxy } : {}),
          ...(config.registryPk ? { privateKey: config.registryPk } : {}),
        },
        tracer,
      )
    : null;

  const app = await buildServer({
    config,
    engine,
    registryRead: registry,
    registryWrite: registry?.hasWrite() ? registry.writer() : null,
    secrets,
    nonces: redisClient ? new RedisNonceStore(redisClient) : new NonceStore(),
    idempotencyStore: redisClient ? new RedisIdempotencyStore(redisClient) : new InMemoryIdempotencyStore(),
    audit,
    metrics,
    clock: { nowMs: () => Date.now() },
    tracer,
  });

  await app.ready();

  const address = await app.listen({ port: config.port, host: config.host });
  app.log.info({ address, circuits: (await engine.listCircuits()).length }, 'zkp-engine API listening');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

// lineage: do not start when imported by tests
if (import.meta.url === new URL(`file://${process.argv[1]}`, 'file:').href) {
  main(process.argv.slice(2), process.env).catch((err) => {
    if (err instanceof ConfigError) {
      console.error(`configuration error:\n${err.fields.map((f) => `  - ${f}`).join('\n')}`);
    } else {
      console.error('fatal:', err instanceof Error ? err.message : err);
    }
    process.exit(1);
  });
}

export { traceContextFromHeaders };
export { ApiClient, ApiClientError, type ApiClientConfig, type ApiErrorDetail } from './client.js';
export { buildServer, type ServerDeps } from './api/buildServer.js';
export { parseConfig, ConfigError } from './config.js';
export { NoopTracer } from './telemetry/telemetry.js';
export { EnvSecretStore } from './infrastructure/auth/EnvSecretStore.js';
export { NonceStore } from './infrastructure/auth/NonceStore.js';
export { InMemoryIdempotencyStore } from './infrastructure/auth/IdempotencyStore.js';
export { AuditLog } from './infrastructure/observability/AuditLog.js';
export { Metrics } from './infrastructure/observability/Metrics.js';
export { canonicalString, hmacSha256Hex } from './application/auth.js';
export type { EnginePort, RegistryReadPort, RegistryWritePort } from './domain/ports.js';
export type { CircuitInfo, VerifyOutcome, RegistryInfo, ProofStatusEntry } from './domain/entities.js';
