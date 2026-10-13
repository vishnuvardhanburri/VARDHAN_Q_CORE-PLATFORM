# ADR-0006 — v1 Circuit Set & Proof Format

**Status:** Accepted (pending approval)
**Date:** 2026-08-07

## Context
The whole system needs at least one end-to-end path to validate plumbing, and the gatekeeper
needs a meaningful predicate. The proof format must be stable versioned shared artifact.

## Decision

> **Superseded (2026-08-09):** the circuit-set part of this ADR is replaced
> by ADR-0008 amendment 1 — the shipped v1 set is `poseidon-preimage@1` +
> `merkle-inclusion@1`; the `sha256-preimage` circuit proposed below was
> never built (toolchain miscompiles `sha256.circom`; docs/13 §3) and is
> deferred. The proof-format part of this ADR remains in force.

**v1 circuit set (two circuits):**
1. **`sha256-preimage`** — prove knowledge of a preimage for a public SHA-256 digest. The
   universal "hello world" circuit; validates the full toolchain cheaply.
2. **`merkle-inclusion`** — prove membership of a private leaf in a public Merkle root.
   The production-shaped circuit used by the registry/gatekeeper demo (e.g. allowing only
   whitelisted addresses to pass a gate).

**Proof format (`packages/proof-format`), versioned:**
```ts
interface ProofEnvelope {
  formatVersion: 1;
  circuitId: string;
  circuitVersion: string;
  vkHash: string;            // keccak256(public vkey)
  publicInputs: string[];    // field-element strings, canonical order
  proof: { a: string; b: string[]; c: string }; // groth16
  proverTimestamp?: number;
  proofHash: string;         // keccak256(canonical bytes of the above minus proofHash)
}
```

## Consequences
- Registry/verifier contract consumes the format directly (milestone 4).
- Test matrix is `2 circuits × (local verify + on-chain verify)`.
- Adding circuits later is additive (`circuitId` namespace); no format break.

## Amendment 1 (2026-08-08, M2)

Signed envelopes are versioned `formatVersion: 2` (ADR-0009): the v1 envelope
plus a `signature` section (`algo`, `keyId`, `value`, optional `keyVersion`).
`proofHash` covers the content (signature excluded); the Ed25519 signature
covers the canonical envelope minus the signature section (formatVersion and
proofHash included — downgrade-proof). v1 remains readable; `requireSigned`
policy applies at the gatekeeper. The circuit set in this ADR is superseded
by ADR-0008 amendment 1 (`poseidon-preimage`, `merkle-inclusion`).