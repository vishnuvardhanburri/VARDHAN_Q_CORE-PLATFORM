/**
 * Environment configuration — single Zod schema over process.env (ZK_*).
 * Validated at startup in main(); invalid values are reported by field name
 * (never values) and the process exits before any listener binds (§16).
 */

import { z } from 'zod';

const keyEntry = z.string().refine(
  (entry) => {
    const parts = entry.split(':');
    // Formats: clientId:secret:roles  OR  clientId:secret:roles:tenantId
    return (parts.length === 3 || parts.length === 4) && parts[0]!.length > 0 && parts[1]!.length >= 32;
  },
  { message: 'expected clientId:secret(>=32 chars):role[,role][:tenantId]' },
);

export const configSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535).default(8080),
  host: z.string().min(1).default('0.0.0.0'),
  authTtlSeconds: z.coerce.number().int().min(1).max(3600).default(300),
  apiKeys: z
    .string()
    .min(1)
    .transform((raw) => raw.split(';').filter(Boolean).map((e) => e.trim()))
    .refine((entries) => entries.length >= 1, { message: 'at least one clientId:secret:roles entry required' })
    .refine((entries) => entries.every((e) => keyEntry.safeParse(e).success), {
      message: 'malformed entry (expected clientId:secret(>=32 chars):role[,role])',
    })
    .refine((entries) => {
      const ids = entries.map((e) => e.split(':')[0]!);
      return new Set(ids).size === ids.length;
    }, { message: 'duplicate clientId in ZK_API_KEYS' }),
  registryRpc: z
    .string()
    .url()
    .refine((u) => u.startsWith('http://') || u.startsWith('https://'), { message: 'must be http(s) URL' })
    .optional()
    .or(z.literal('')),
  registryProxy: z
    .string()
    .regex(/^(0x[0-9a-fA-F]{40}|)$/, 'must be a 0x address or empty')
    .optional(),
  registryPk: z
    .string()
    .regex(/^(0x[0-9a-fA-F]{64}|)$/, 'must be a 64-hex private key or empty')
    .optional(),
  auditFile: z.string().optional(),
  rateCapacity: z.coerce.number().int().min(1).default(60),
  rateRefillPerMinute: z.coerce.number().int().min(1).default(20),
  rateVerifyCapacity: z.coerce.number().int().min(1).default(8),
  rateVerifyRefillPerMinute: z.coerce.number().int().min(1).default(4),
  maxPayloadBytes: z.coerce.number().int().min(1024).max(1_048_576).default(65_536),
  idempotencyTtlMs: z.coerce.number().int().min(1000).default(86_400_000),
  /**
   * Maximum number of concurrent snarkjs verify/prove calls.
   * Prevents CPU exhaustion under burst load (§6 resource-exhaustion).
   * Default: 8 (matches rateVerifyCapacity).
   */
  maxConcurrentVerify: z.coerce.number().int().min(1).max(256).default(8),
  otelEndpoint: z.string().optional(),
  otelDisabled: z.coerce.boolean().default(false),
  otelSamplerRatio: z.coerce.number().min(0).max(1).default(1),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  redisUrl: z.string().url().optional(),
});

export type Config = z.infer<typeof configSchema>;

export interface KeyEntry {
  clientId: string;
  secret: string;
  roles: string[];
  /** Tenant identifier; defaults to clientId when not specified. */
  tenantId: string;
}

export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const raw = {
    port: env.ZK_PORT ?? env.PORT,
    host: env.ZK_HOST,
    authTtlSeconds: env.ZK_AUTH_TTL,
    apiKeys: env.ZK_API_KEYS,
    registryRpc: env.ZK_REGISTRY_RPC,
    registryProxy: env.ZK_REGISTRY_PROXY,
    registryPk: env.ZK_REGISTRY_PK,
    auditFile: env.ZK_AUDIT_FILE,
    rateCapacity: env.ZK_RATE_CAPACITY,
    rateRefillPerMinute: env.ZK_RATE_REFILL_PER_MINUTE,
    rateVerifyCapacity: env.ZK_RATE_VERIFY_CAPACITY,
    rateVerifyRefillPerMinute: env.ZK_RATE_VERIFY_REFILL_PER_MINUTE,
    maxPayloadBytes: env.ZK_MAX_PAYLOAD_BYTES,
    idempotencyTtlMs: env.ZK_IDEMPOTENCY_TTL_MS,
    maxConcurrentVerify: env.ZK_MAX_CONCURRENT_VERIFY,
    otelEndpoint: env.ZK_OTEL_ENDPOINT,
    otelDisabled: env.ZK_OTEL_DISABLED,
    otelSamplerRatio: env.ZK_OTEL_SAMPLER_RATIO,
    logLevel: env.ZK_LOG_LEVEL,
  };
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const fields = result.error.issues.map((i) => `${i.path.join('.')} — ${i.message}`);
    throw new ConfigError(`invalid configuration: ${fields.join('; ')}`, fields);
  }
  return result.data;
}

export class ConfigError extends Error {
  constructor(message: string, readonly fields: string[]) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Parse ZK_API_KEYS into structs (used by EnvSecretStore). */
export function parseApiKeys(raw: string): { clientId: string; secret: string; roles: string[]; tenantId: string }[] {
  return raw
    .split(';')
    .map((e) => e.trim())
    .filter(Boolean)
    .map((entry) => {
      const [clientId, secret, rolesRaw, tenantId] = entry.split(':');
      return {
        clientId: clientId!,
        secret: secret!,
        roles: rolesRaw!.split(',').map((r) => r.trim()),
        // tenantId is optional: default to clientId for single-tenant deployments
        tenantId: tenantId ?? clientId!,
      };
    });
}