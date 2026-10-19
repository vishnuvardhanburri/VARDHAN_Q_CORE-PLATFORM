# ADR-0007 — Versioned Circuit Interface

**Status:** Accepted (pending approval)
**Date:** 2026-08-07

## Context
The proof engine, witness generator, API, contracts, and gatekeeper must not be coupled
to any specific circuit. Future circuits (new predicates, new proof shapes) must be
addable without touching shared architecture.

## Decision
Define a **Versioned Circuit Interface** (VCI) — one cross-cutting contract enforced by
all consumers:

1. **`CircuitManifest`** — a JSON document, content-addressed by `manifestHash`, declaring:
   - `circuitId` (`string`) and `circuitVersion` (`semver` like `1.0.0`)
   - `knn:curvesheme` (`groth16` for v1; future `plonk`/`halo2`)
   - `inputs`: ordered public input schema (name → field type/arity)
   - `privateInputs`: ordered private input schema
   - `maxConstraints`, `digest`/`hashes` of r1cs & wasm artifacts
   - `vkHash` (once keys exist)
   - `compatibility`: `engine >=`/`contractVersion >=` constraints
2. **`CircuitAdapter`** — a TS interface implemented per circuit, exposing:
   - `parseInputs(raw) → { public, private }` (validated, canonical F_r encoding)
   - `generateWitness(public, private) → witness`
   - `verifyWitnessValidity(witness)` (unit-relational gate)
   - `prove(pk, public, private) → groth16 proof`
   - `getVerificationKey() → vk` / `vkHash`
   - `capabilities()` (dep version, hardware gourmet)
3. **Registry-of-adapter pattern**: the engine/API maintain a
   `Map<circuitId, Adapter>`; unknown IDs produce `404`/clear error — no central switch.

## Versioning rules
- `circuitId` immutable; additive input changes bump `circuitVersion` minor; breaking
  input/relation changes create a new `circuitId` (e.g. `merkle-inclusion@2`).
- Consumers (API schemas, gatekeeper allow-list, contract `allowedCircuitIds`) read the
  manifest; unknown version → explicit rejection.

## Consequences
- New circuit = new `packages/circuit-lib/<id>@<v>` + adapter; zero changes to engine/API/
  contracts/dashboard beyond allow-list updates.
- The `proof-format` envelope is unchanged; `scheme` field makes it forward-extensible.
- Contracts store `circuitId → verifierAddress` mapping (already designed in ADR-0004);
  adding a circuit is an admin registration transaction.

## Alternatives considered
- Hard-coded circuits with `if-else` in the engine: rejected — violates VCI goal.
- Auto-discovery via file scan at runtime: rejected — explicit allow-list is auditable.