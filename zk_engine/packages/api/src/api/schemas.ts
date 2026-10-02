/**
 * Route schemas — single source of truth for request/response shapes
 * (§8/§9). Parsed with Zod; serialized to JSON Schema by the server for
 * OpenAPI 3.1 generation (§1).
 */

import { z } from 'zod';

export const circuitIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'circuitId must be [a-z0-9][a-z0-9-]*');

export const bytes32Schema = z.string().regex(/^0x[0-9a-f]{64}$/, 'must be 0x + 64 lowercase hex');

/** Canonical BN254 field element as decimal string. */
export const fieldSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, 'field element must be a decimal string')
  .max(78, 'field element too long');

const pointG1 = z.tuple([fieldSchema, fieldSchema, fieldSchema]);
const pointG2 = z.tuple([
  z.tuple([fieldSchema, fieldSchema]),
  z.tuple([fieldSchema, fieldSchema]),
  z.tuple([fieldSchema, fieldSchema]),
]);

export const groth16ProofSchema = z
  .object({
    pi_a: pointG1,
    pi_b: pointG2,
    pi_c: pointG1,
  })
  .strict();

export const proofSubmissionSchema = z
  .object({
    circuitId: circuitIdSchema,
    proof: groth16ProofSchema,
    publicInputs: z.array(fieldSchema).min(1).max(128),
  })
  .strict();

export const idempotencyKeyHeaderSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);
export const correlationIdHeaderSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const statusParamsSchema = z.object({
  circuitId: circuitIdSchema,
  publicInputHash: bytes32Schema,
});

export const verifyResponseSchema = z.object({
  verified: z.boolean(),
  circuitId: circuitIdSchema,
  publicInputHash: bytes32Schema,
});

export const registerResponseSchema = z.object({
  verified: z.literal(true),
  circuitId: circuitIdSchema,
  publicInputHash: bytes32Schema,
  txHash: z.string().regex(/^0x[0-9a-f]{64}$/),
});

export const statusResponseSchema = z.object({
  circuitId: circuitIdSchema,
  status: z.enum(['unproved', 'proved', 'revoked']),
  provedAt: z.string(),
});

export const registryInfoResponseSchema = z.object({
  proxy: z.string(),
  schemaVersion: z.string(),
  totalProofs: z.string(),
  paused: z.boolean(),
  circuits: z.record(z.string(), z.string()),
});

export const auditListParamsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  action: z.string().optional(),
});