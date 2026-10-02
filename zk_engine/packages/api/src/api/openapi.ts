/**
 * Wire/JSON Schemas for Fastify (Ajv validation + Swagger render).
 *
 * Zod schemas in `./schemas.ts` remain the source of truth for *parsing*
 * (handlers re-parse with Zod, §8/§9 addendum); these JSON Schema mirrors
 * feed Fastify's validation/coercion and the OpenAPI document. Keeping them
 * in one file makes the mirroring reviewable.
 */

const field = {
  type: 'string',
  pattern: '^(0|[1-9][0-9]*)$',
  maxLength: 78,
  description: 'BN254 field element as a decimal string (no leading zeros)',
} as const;

const g1Point = {
  type: 'array',
  minItems: 3,
  maxItems: 3,
  items: field,
} as const;

const g2Point = {
  type: 'array',
  minItems: 3,
  maxItems: 3,
  items: {
    type: 'array',
    minItems: 2,
    maxItems: 2,
    items: field,
  },
} as const;

const circuitId = {
  type: 'string',
  pattern: '^[a-z0-9][a-z0-9-]*$',
  minLength: 1,
  maxLength: 64,
} as const;

const bytes32 = {
  type: 'string',
  pattern: '^0x[0-9a-f]{64}$',
} as const;

export const groth16Proofs = {
  type: 'object',
  additionalProperties: false,
  required: ['pi_a', 'pi_b', 'pi_c'],
  properties: {
    pi_a: g1Point,
    pi_b: g2Point,
    pi_c: g1Point,
  },
} as const;

/** POST /v1/proofs/verify & /v1/proofs/register */
export const proofSubmission = {
  type: 'object',
  additionalProperties: false,
  required: ['circuitId', 'proof', 'publicInputs'],
  properties: {
    circuitId,
    proof: groth16Proofs,
    publicInputs: {
      type: 'array',
      minItems: 1,
      maxItems: 128,
      items: field,
    },
  },
} as const;

export const verifyResponse = {
  type: 'object',
  required: ['verified', 'circuitId', 'publicInputHash'],
  properties: {
    verified: { type: 'boolean' },
    circuitId,
    publicInputHash: bytes32,
  },
} as const;

export const registerResponse = {
  type: 'object',
  required: ['verified', 'circuitId', 'publicInputHash', 'txHash'],
  properties: {
    verified: { const: true },
    circuitId,
    publicInputHash: bytes32,
    txHash: { type: 'string', pattern: '^0x[0-9a-f]{64}$' },
  },
} as const;

export const statusParams = {
  type: 'object',
  required: ['circuitId', 'publicInputHash'],
  properties: { circuitId, publicInputHash: bytes32 },
} as const;

export const statusResponse = {
  type: 'object',
  required: ['circuitId', 'status', 'provedAt'],
  properties: {
    circuitId,
    status: { type: 'string', enum: ['unproved', 'proved', 'revoked'] },
    provedAt: { type: 'string' },
  },
} as const;

export const registryInfoResponse = {
  type: 'object',
  required: ['proxy', 'schemaVersion', 'totalProofs', 'paused', 'circuits'],
  properties: {
    proxy: { type: 'string' },
    schemaVersion: { type: 'string' },
    totalProofs: { type: 'string' },
    paused: { type: 'boolean' },
    circuits: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['verifier', 'vkHash', 'active'],
        properties: {
          verifier: { type: 'string' },
          vkHash: bytes32,
          active: { type: 'boolean' },
        },
      },
    },
  },
} as const;

export const circuitListResponse = {
  type: 'object',
  required: ['circuits'],
  properties: {
    circuits: {
      type: 'array',
      items: {
        type: 'object',
        required: ['circuitId', 'version', 'label', 'nPublic', 'artifactsReady'],
        properties: {
          circuitId,
          version: { type: 'string' },
          label: { type: 'string' },
          nPublic: { type: 'integer' },
          artifactsReady: { type: 'boolean' },
        },
      },
    },
  },
} as const;

export const auditListResponse = {
  type: 'object',
  required: ['entries'],
  properties: {
    entries: { type: 'array', items: { type: 'object' } },
  },
} as const;

/** Routing registry used by buildServer. */
export const schemaRegistry = {
  proofSubmission,
  verifyResponse,
  registerResponse,
  statusParams,
  statusResponse,
  registryInfoResponse,
  circuitListResponse,
  auditListResponse,
} as const;