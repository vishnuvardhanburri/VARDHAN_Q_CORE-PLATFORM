import {
  CIRCUIT_MANIFEST_VERSION,
  SUPPORTED_CURVES,
  SUPPORTED_SCHEMES,
  HEX_DIGEST_PATTERN,
  SEMVER_PATTERN,
} from './constants.js';
import { canonicalize } from './canonical.js';
import { keccak256Utf8 } from './hash.js';
import type { CircuitManifest } from './types.js';

/**
 * manifestHash = keccak256(canonical(manifest)).
 * Content-addressed declaration per ADR-0007.
 */
export function computeManifestHash(manifest: Omit<CircuitManifest, 'manifestHash'>): string {
  return keccak256Utf8(canonicalize(manifest));
}

function isValidInputSpecList(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return false;
    const s = item as Record<string, unknown>;
    if (typeof s['id'] !== 'string' || s['id'].length === 0) return false;
    if (!['field', 'u8', 'u32', 'u1'].includes(s['type'] as string)) return false;
    if (typeof s['arity'] !== 'number' && typeof s['arity'] !== 'string') return false;
    if (typeof s['arity'] === 'number' && (s['arity'] < 1 || !Number.isInteger(s['arity']))) {
      return false;
    }
  }
  return true;
}

function isValidOutputSpecList(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return false;
    const s = item as Record<string, unknown>;
    if (typeof s['id'] !== 'string' || s['id'].length === 0) return false;
    if (!['u1', 'field'].includes(s['type'] as string)) return false;
    if (typeof s['arity'] !== 'number' || !Number.isInteger(s['arity']) || s['arity'] < 1) {
      return false;
    }
  }
  return true;
}

/**
 * Structural validation of a CircuitManifest. Returns a list of errors
 * (empty = valid). Does NOT verify artifact hashes against files.
 */
export function validateManifest(value: unknown): string[] {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null) {
    return ['manifest must be an object'];
  }
  const m = value as Record<string, unknown>;

  if (m['manifestVersion'] !== CIRCUIT_MANIFEST_VERSION) {
    errors.push(`manifestVersion must be ${CIRCUIT_MANIFEST_VERSION}`);
  }
  if (typeof m['circuitId'] !== 'string' || m['circuitId'].length === 0) {
    errors.push('circuitId must be a non-empty string');
  }
  if (typeof m['circuitVersion'] !== 'string' || !SEMVER_PATTERN.test(m['circuitVersion'])) {
    errors.push('circuitVersion must be semver');
  }
  if (!SUPPORTED_SCHEMES.includes(m['scheme'] as never)) {
    errors.push(`scheme must be one of ${SUPPORTED_SCHEMES.join(', ')}`);
  }
  if (!SUPPORTED_CURVES.includes(m['curve'] as never)) {
    errors.push(`curve must be one of ${SUPPORTED_CURVES.join(', ')}`);
  }
  if (!isValidInputSpecList(m['inputs'])) errors.push('inputs schema invalid');
  if (!isValidInputSpecList(m['privateInputs'])) errors.push('privateInputs schema invalid');
  if (!isValidOutputSpecList(m['outputs'])) errors.push('outputs schema invalid');

  const artifacts = m['artifacts'] as Record<string, unknown> | undefined;
  if (typeof artifacts !== 'object' || artifacts === null) {
    errors.push('artifacts object required');
  } else {
    for (const key of ['r1cs', 'wasm', 'zkey'] as const) {
      if (typeof artifacts[key] !== 'string' || !HEX_DIGEST_PATTERN.test(artifacts[key] as string)) {
        errors.push(`artifacts.${key} must be a 0x-prefixed sha256 digest`);
      }
    }
    const vk = artifacts['vk'] as Record<string, unknown> | undefined;
    if (typeof vk !== 'object' || vk === null) {
      errors.push('artifacts.vk object required');
    } else {
      if (typeof vk['vkHash'] !== 'string' || !HEX_DIGEST_PATTERN.test(vk['vkHash'] as string)) {
        errors.push('artifacts.vk.vkHash must be a 0x-prefixed digest');
      }
      if (typeof vk['sha256'] !== 'string' || !HEX_DIGEST_PATTERN.test(vk['sha256'] as string)) {
        errors.push('artifacts.vk.sha256 must be a 0x-prefixed digest');
      }
    }
  }

  const constraints = m['constraints'] as Record<string, unknown> | undefined;
  if (typeof constraints !== 'object' || constraints === null) {
    errors.push('constraints object required');
  } else {
    const { estimated, max } = constraints as { estimated?: unknown; max?: unknown };
    if (typeof estimated !== 'number' || estimated < 1 || !Number.isInteger(estimated)) {
      errors.push('constraints.estimated must be a positive integer');
    }
    if (typeof max !== 'number' || max < 1 || !Number.isInteger(max)) {
      errors.push('constraints.max must be a positive integer');
    }
  }

  if (errors.length === 0) {
    const { manifestHash: _omitted, ...withoutHash } = m;
    const recomputed = computeManifestHash(
      withoutHash as unknown as Omit<CircuitManifest, 'manifestHash'>,
    );
    if (recomputed !== m['manifestHash']) {
      errors.push('manifestHash does not match canonical manifest contents');
    }
  }
  return errors;
}
