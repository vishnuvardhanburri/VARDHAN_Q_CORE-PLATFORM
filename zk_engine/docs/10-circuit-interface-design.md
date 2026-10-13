# 10 — Versioned Circuit Interface (Design Spec)

**Status:** Complete (revision per architecture review)
**Date:** 2026-08-07

Normative companion to ADR-0007. Defines the machine contract for adding circuits.

---

## 1. Goals (non-functional requirements)

- **G-Iso:** adding/removing a circuit never requires edits to engine, API route table,
  contract logic, or dashboard.
- **G-Ver:** a circuit's interface is versioned so old proofs remain verifiable while new
  versions are added.
- **G-Audit:** consumers can enumerate available circuits and their exact input schemas
  without executing code.

## 2. CircuitManifest (JSON, v1)

```jsonc
{
  "manifestVersion": 1,
  "circuitId": "merkle-inclusion",
  "circuitVersion": "1.0.0",
  "scheme": "groth16",                      // now:groth16; future: plonk | halo2
  "curve": "bn254",
  "inputs": [                                 // public, canonical order
    { "id": "root",   "type": "field",  "arity": 1 },
    { "id": "height", "type": "u8",     "arity": 1 },
    { "id": "index",  "type": "u32",    "arity": 1 }
  ],
  "privateInputs": [
    { "id": "leaf",  "type": "field", "arity": 1 },
    { "id": "path",  "type": "field", "arity": "height" }   // variable arity bound to input
  ],
  "outputs": [{ "id": "isZero", "type": "u1", "arity": 1 }],
  "artifacts": {
    "r1cs":  "sha256:<hex>",
    "wasm":  "sha256:<hex>",
    "zkey":  "sha256:<hex>",
    "vk":    { "vkHash": "0x…", "sha256": "<hex>" }
  },
  "constraints": { "estimated": 16384, "max": 65536 },
  "compatibility": { "minEngine": "1.0.0", "minProofFormat": "1.0.0" }
}
```

## 3. CircuitAdapter Interface (TypeScript)

```ts
/** package proof-format, re-exported by engine */
export interface CircuitAdapter {
  readonly id: string;                  // e.g. "merkle-inclusion"
  readonly version: string;             // "1.0.0"
  readonly manifest: CircuitManifest;

  loadManifest(allowList: string[]): Promise<SessionOutput>;
  parseInputs(raw: unknown): Promise<ResolvedInputs>;   // {public, private} canonical fr
  generateWitness(i: ResolvedInputs): Promise<Uint8Array>;
  assertWitnessValid(w: Uint8Array): Promise<void>;     // satisfies C(x,w)=0 graph
  prove(pk: ProvingKey, i: ResolvedInputs): Promise<Groth16Proof>;
  verify(vk: VerificationKey, publicInputs: Fr[]): Promise<boolean>;
  vkHash(): Promise<string>;
  artifacts(): CircuitArtifacts;   // hashed paths
}
```

## 4. Lifecycle

| Stage | Who | Action |
|-------|-----|--------|
| Author | engineer | add `packages/circuit-lib/<id>`; compile → r1cs, wasm |
| certify | script `scripts/certify-circuit` | hash artifacts, validate manifest (schema), set vkHash post-keygen |
| register | CI | merge registers `circuitId` in engine allow-list + network registry + API routing table (admin) |
| consume | anyone | engine, API, CLI, gatekeeper resolve via `CircuitRegistry` |
| evolve | engineer | bump `circuitVersion` (additive) or new `circuitId` (breaking) |

## 4. Registry & consumer behavior

- `CircuitRegistry.get(id)` returns `Circuit` or a typed `CircuitNotFoundError`.
- Consumers **never** match on `id` strings with code branches; they use the manifest's
  input schema to render forms / build schemas (Zod precompiled from manifest).
- `vkHash` allow-list: the gatekeeper and registry contract consult the same set; during
  voting, new circuits are added before they can gate anything.

## 5. Security properties

- Manifest hashes are checked before artifacts are loaded (Security T1).
- `circuitVersion` includes the signal graph; two manifests with the same `circuitId` but
  different `vkHash` = different proof targets (no downgrade attacks because gatekeeper
  pins allow-listed `vkHash`s).
- Adapter is sandboxed read-only file access to its own artifact directory.

## 6. Test matrix (per new circuit, in CI)

1. Manifest validates against `proof-format` schema (M11 e2e).
2. Witness generation matches golden vector.
3. Local verify = true; tamper-negatives fail.
4. Adapter without allow-listed `vkHash` is rejected by gatekeeper.
5. Contract registration succeeds; registry cross-check local-side agreement.