# 09 — Formal Proof Specification

**Status:** Complete (revision 2 — release-consistency audit)
**Date:** 2026-08-07 (rev. 2026-08-09)
**Scope:** defines exactly what a proof attests to, the trust assumptions, and the
security guarantees. Normative for the engine, API, contracts, and gatekeeper.

---

## 1. Notation

- `F_r` — scalar field of BN254 (order r).
- `C` — a circuit (R1CS instance) identified by `circuitId`.
- `x ∈ F_r^m` — public inputs (the statement).
- `w ∈ F_r^n` — private inputs (the witness).
- `π` — a Groth16 proof `(A, B, C)`.
- `vk` — verification key; `vkHash = keccak256(canonical-vk)`.
- `P(x; w)` — prover; `V(vk, x, π)` — verifier.
- `Poseidon2` — the Poseidon-2 hash built from the BN254 Poseidon permutation
  (`poseidon(2, t=3)` in circomlib, per ADR-0008).

## 2. Implemented v1 Circuits

The **only** circuits shipped in the current release are:

| circuitId | version | public inputs `x` | private inputs `w` | constraints |
|-----------|---------|-------------------|--------------------|-------------|
| `poseidon-preimage@1` | 1.0.0 | `digest` (2 field elements) | `preimage` (2 field elements) | 240 |
| `merkle-inclusion@1` | 1.0.0 | `rootPub` (1), `isZero` (1) | `leaf` (2), `siblings` (4), `pathBits` (4) | 974 |

(Counts from the certified manifests in `packages/circuit-lib/build/*.manifest.json`.)

**`poseidon-preimage@1`** — proves that the prover knows a private 2-field
preimage `p ∈ F_r^2` such that `Poseidon2(p) = digest`, where `digest` is the
public input.

**`merkle-inclusion@1`** — proves that the prover knows a leaf value and a
Merkle path such that the height-4 binary tree root computed from
`(leaf, siblings, pathBits)` equals the public input `height`; `isZero` is
`1` iff the recomputed root matches (the verifier/consumer checks `isZero=1`
to accept membership).

No other relation is implemented. In particular, **no SHA-256 circuit is
proven in v1** (see §7.3 and ADR-0008 amendment).

## 2.1 What the current system proves

A proof produced by the current system attests **exactly** to the relation

> **R = { (x, w) : C(x, w) = 0 }**

for the two v1 circuits above, i.e.:

1. For `poseidon-preimage@1`: the prover knows a preimage `p` of the public
   digest (the arithmetic part of the relation).
2. For `merkle-inclusion@1`: the prover knows a leaf + path whose recomputed
   root equals the public root (the arithmetic part of the relation).

The proof is cryptographically **bound to the following named values**, and
nothing else:

- `circuitId` (which relation was proven, e.g. `merkle-inclusion@1`);
- `vkHash` — hash of the exact verification key used;
- `publicInputs` — the exact statement, bound through `publicInputHash`
  (`keccak256(abi.encode(uint256[] public inputs))`), which is the key used
  on-chain;
- the proof itself (`π`), bound in the envelope through `proofHash`
  (`keccak256(canonical envelope minus proofHash/signature)`) at rest and
  re-verified by the verifier;
- `artifactHash` — hash of the **circuit artifact bundle** (r1cs/wasm/zkey
  verification key + manifest) that the envelope's CLI run was built from.
  It proves which *circuit implementation* was used — see §2.2 for the sharp
  boundary.

A verifier that checks `V(vk, x, π)` plus the envelope binding learns nothing
about `w` (zero-knowledge) and can be sure the prover knew `w` (Groth16
extractability).

## 2.2 What the current system does **NOT** prove

These are **explicitly outside** the guarantees of the v1 release:

- It does **NOT** prove that "private source code produced a particular
  application binary". Relation `R` above does not mention any source code or
  executable; v1 circuits contain no such hash binding.
- It does **not** prove who the prover was, that the prover had permission,
  or that the signing key’s holder is the prover. Signature + envelope
  provenance (Ed25519) is a separate, non-ZK claim (ADR-0009).
- It does NOT prove that an artifact is *trustworthy*, *reviewed*, or
  *vulnerability-free*, even when `artifactHash` matches the certified
  bundle. `artifactHash` is a hash of the circuit artifacts, not of the
  application.
- It does NOT prove that the public inputs are "business-valid" — only that
  the relation holds on them (e.g. `isZero=1` for merkle-inclusion must be
  consumed by the caller).
- It does NOT prove the real-world timestamp of the prove step; on-chain
  `provedAt` records *registration time* (`block.timestamp` at register),
  which is what gate checks use for expiry.
- It does NOT constitute a binary supply-chain provenance statement (e.g.
  "this exact executable was built by this exact compiler from this exact
  source"). Making that claim requires a **new circuit** (source
  commit-to-binary binding) — see §7.3.

Where documentation or marketing material claims "proven artifact from a
trusted build", the claim is **toolchain-level**: only the circuit *artifact
bundle* (r1cs/wasm/zkey/vk) has been hashed and committed. No claim is
made that the application binary derives from any specific source.

## 3. Security Guarantees (formal)

Same as before; the *envelope* semantics below expand G5.

**G1 — Completeness (perfect).** For all `(x, w) ∈ R` and all honestly
generated `(pk, vk)`, `Verify(vk, x, Prover(pk, x, w)) = 1`.

**G2 — Soundness (computational).** For any poly-time adversary `A`, the
probability that `A` outputs `(x, π)` with `Verify(vk, x, π) = 1` but
`x ∉ L_R` (no witness exists) is negligible in `λ`. Holds under ℓ-SDH /
ℓ-DLOG for Groth16 on BN254.

**G3 — Knowledge soundness (extractability).** There exists an extractor `E`
such that if a valid proof is output, `E` (with access to the prover's
randomness) outputs `w` with `(x, w) ∈ R` — the proof is a *proof of
knowledge*.

**G4 — Zero-knowledge (perfect/statistical).** A simulated proof
`S(vk, x)` is indistinguishable from `Prove(pk, x, w)`: the verifier
learns nothing about `w` beyond `x` and the verdict.

**G5 — Binding.**

- *Envelope binding:* `proofHash = keccak256(canonical(envelope minus
  proofHash/signature))`. Changing any semantic field of the envelope
  (formatVersion, circuitId, vkHash, publicInputs, artifactHash, A, B, C)
  changes `proofHash` and the signature fails.
- *On-chain binding:* the leaf is the on-chain `proofHash`
  (see §6.2) — committed in the append-only `proofLeaves` set of the
  registry. Replay in a different context (different `publicInputs` or
  `circuitId`) changes the leaf, which is not in the set.

## 4. Trust Assumptions

| # | Assumption | Requirement | Mitigation |
|---|-----------|-------------|------------|
| T-SETUP | Groth16 trusted setup: at least one ceremony participant is honest | ADR-0003 two-regime setup; dev weak-PTau never used in prod | Prod uses community ceremony (DEBT-1); zkey hash published |
| T-VK | `vkHash` given to verifiers/registry is the genuine hash of the vk the prover used | vk artifact hashing + allow-lists in gatekeeper | vkHash allow-list in API/contracts; tampered vk rejected |
| T-PT | PTau files have the claimed security size & checksum | checksums committed in repo | circuit-lib refuses un-hashed PTau |
| T-ENG | The engine performs exactly `Prove(pk,x,w)` with no altered coefficients | pinned snarkjs + lockfile; compile-from-source artifacts | artifact pinning (Security T1) |
| T-RAND | Prover uses good randomness for Groth16 blinding | CSPRNG via Node crypto | documented in ops runbook |
| T-PRIV | Private inputs are handled only on the prover's machine | architecture boundary (ADR-0005) | no private fields in API schemas |

## 5. Formal Flow (normative sequence)

```
1. loadCircuit(circuitId@version) → manifest, r1cs, wasm, zkey, vk
2. assert manifest.vkHash == keccak256(canonical(vk))      // T-VK
3. w = computeWitness(manifest, x, w)                       // validation
4. assert circuitRelation(manifest, x, w) holds (unit gate)
5. π = groth16Prove(pk, x, w)
6. envelope = { formatVersion, circuitId, circuitVersion, vkHash,
               publicInputs, artifactHash, proof, proofHash }
7. assert verify(vk, x, π) == true                          // offline
8. API register(execute(proof), signing) → on-chain           Verify + anchor
```

## 6. Proof-Format & Registry Binding (terminology)

Four distinct values — do not conflate them:

| Term | Definition | Where it lives |
|------|-----------|----------------|
| `vkHash` | `keccak256(canonical JSON of the verification key)` | envelope, manifest, registry config |
| `publicInputHash` | `keccak256(abi.encode(publicInputs-as-uint256[]))` — the **statement key** | envelope (`proofs` DTO), registry `proofStatus[circuitId][publicInputHash]` |
| `proofHash` | envelope: `keccak256(canonical(envelope minus proofHash/signature))` — **you transport the whole proof**; on-chain: `keccak256(abi.encode(circuitId, vkHash, publicInputs, a, b, c))` — **registry leaf** | envelope; registry `proofLeaves` append-only set |
| `artifactHash` | `sha256(canonical(artifact bundle))` — r1cs + wasm + zkey + vk of the **circuit**, as certified by circuit-lib | envelope (optional `artifactHash`), CLI binding |

**Registry (`ZKVerifierRegistry.sol`, as deployed):**

```
publicInputHash := keccak256(abi.encode(publicInputs))        // uint256[]
onchain-proofHash := keccak256(abi.encode(circuitId, vkHash, publicInputs, a, b, c))
proofLeaves[onchain-proofHash] = true                        // append-only, never deleted
proofStatus[circuitId][publicInputHash] = { status, provedAt }  // promote to revoked tombstone
getProofStatus(circuitId, publicInputHash) → Proved | Revoked | None
requireProved(circuitId, publicInputHash, maxAge) → reverts unless Proved ∧ not expired
revokeProof(circuitId, publicInputHash) → permanent tombstone
```

The `a`,`b`,`c` arrays are the Groth16 proof points in
affine form, matching the generated `Verifier.sol` (`a_P1[2]`, `b_P2[4]`
real-first Fp2 swap, `c_P1[2]`).

## 7. Provided & Missing Capabilities

### 7.1 Verified paths

- **Offline:** snarkjs `groth16Verify(vk, x, π)` with `vkHash` checked.
- **On-chain:** generated `Verifier.sol` called by the registry; single
  `ecpairing` check.
- **Cross-check (M4 gate):** 100% agreement between the two methods across the
  canonical vector corpus, plus tamper negatives (tampered π, swapped inputs,
  wrong vk).

### 7.2 Not implemented in v1 (tracked debt)

- SHA-256/preimage circuit (toolchain blocked `sha256.circom` under the
  available circom; deferred; see docs/13 §3).
- Production PTau ceremony (DEBT-1).
- Source→binary provenance (see 7.3).

### 7.3 Source→binary provenance is a **future capability**, not a claim

The current release does **not** implement a circuit that binds private
source code to a produced application binary. Because such a circuit
(witness computation must hash the full compiler + build inputs and compare
against a public binary digest — very different from anything in the v1 set)
cannot claim what isn't built, this document explicitly **defers** it:

> If source→binary provenance becomes a requirement, it must be implemented
> as a **new circuit** (`source-build@1`-style, not an addendum to v1), shipped
> through the standard pipeline (compile → PTau → certify → manifest → API/gate
> allow-list), and added to this specification as a new relation. Timestamp is
> roadmap milestone M12+ (post-release), tracked as "source→binary provenance
> circuit".

**Namespace + certification rule (future-circuit-only):** `source-build@*` is
reserved for provenance circuits and is the ONLY namespace that may carry a
source→binary claim. No historical circuit (`poseidon-preimage@1`,
`merkle-inclusion@1`) may be re-labeled as a provenance circuit in the
registry allow-list — `vkHash` certification (ADR-0012) is the sole entry
path for any `source-build@*` circuit, and the gatekeeper rejects allow-list
entries whose `circuitId` is not certified. Retroactive "provenance" claims
on v1 artifacts (e.g. bolting a source digest onto an envelope post-hoc) are
invalid by definition and must be refused at the API layer (no such field in
`proof-format` v1).

## 8. Versioning & Evolution

- `circuitId@major` is immutable once frozen; changes bump `circuitVersion`
  (additive) or create a new `circuitId` (breaking).
- Adding a circuit follows ADR-0007 (Versioned Circuit Interface) with no
  changes to this specification's guarantees.
- Any attempt to re-label v1's `artifactHash` as "application binary
  provenance" is a spec error: the definition in §2.1/§2.2/§6 prevails.

---
Sources: `packages/circuit-lib/src/circuits.ts` (v1 set), certified manifests,
`contracts/src/ZKVerifierRegistry.sol` (leaf/status semantics), engine verifier,
ADR-0008 amendment. Personal data: none.