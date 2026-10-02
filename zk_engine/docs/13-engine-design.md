# 13 — M1 Implementation Notes: Circuits, Engine, and Toolchain

**Status:** Implemented (M1) · **Date:** 2026-08-08
**Companion docs:** 07 (roadmap), 09 (proof spec), 10 (circuit interface),
11 (performance targets), 12 (crypto design review), ADR-0007, ADR-0008.

---

## 1. Scope (what M1 shipped)

| Package | Version | Role |
|---|---|---|
| `@zkpe/proof-format` | 0.1.0 | Certified manifest + envelope types; keccak256 hashing (M0) |
| `@zkpe/circuit-lib` | 0.1.0 | v1 circuits (circom), compile/keygen/certify pipeline, artifact layout |
| `@zkpe/engine` | 0.1.0 | `HashProvider` registry, input validation, prover, verifier, dev keygen, task model, benchmarks |

## 2. v1 circuit set

| id | version | constraints | public signals | private signals |
|---|---|---|---|---|
| `poseidon-preimage` | 1.0.0 | 240 | `digest` | `preimage[2]` |
| `merkle-inclusion` | 1.0.0 | 974 | `rootPub`, `isZero` | `leaf`, `siblings[4]`, `pathBits[4]` |

- `poseidon-preimage`: prove knowledge of a private 2-field preimage whose
  Poseidon-2 digest equals the public `digest`.
- `merkle-inclusion`: prove membership of a private leaf in a height-4 binary
  tree, nodes hashed with Poseidon-2; `rootPub` publicly binds the root,
  `isZero` is 1 iff the recomputed root matches.

In-circuit hashing is **Poseidon only** (ADR-0008). Binary/external hashing is
SHA-256 (artifacts) and keccak256 (manifest/vk hashing, envelopes) per ADR-0008
and proof-format.

## 3. Toolchain constraints (recorded findings)

Only unofficial circom binaries are usable in this environment (no brew
formula, no native build): `circom-macos-219` (v2.1.9), plus v2.2.1 amd64
binaries, committed under `.tools/`.

1. **SHA-256 is miscompiled by the available binaries** — circomlib 2.0.5
   `sha256.circom` produces wrong witness wiring (garbage length bits, missing
   values). This blocks `sha256-preimage` on this toolchain; it remains a v2
   roadmap item pending an official compiler. v1 is unaffected (Poseidon).
2. **`private` keyword / `main {public [...]}` not parseable.** Effective
   semantics of the pinned v2.1.9 binary: `signal input` → private witness,
   `signal output` → public witness. Verified via `snarkjs r1cs info` and
   `fullProve` output. Manifests record the effective interface.
3. **Array sizes must be compile-time literals** — parameterized sizes are
   rejected; v1 circuits have fixed arity by manifest design.
4. `snarkjs` 0.7.6 exposes no JS API for `groth16 setup` / `zkey export
   verificationkey`; the pinned CLI (`build/cli.cjs`) is used in keygen. Dev
   PTau beacon hex must be **without** `0x` prefix.

## 4. Artifact pipeline (deterministic)

```
npm run build:circuits   # root script: compile → ptau → keygen → certify
```

1. `build:circuits`: circom v2.1.9 → `build/<id>.r1cs` + `_js/<id>.wasm` +
   `<id>.constraints.json` (constraint counts above).
2. `build:ptau`: `powersoftau new bn254 16` + fixed beacon (10 iters) +
   verify + prepare phase2 → deterministic `ptau16_dev.ptau` (dev-only;
   production ceremony is tracked debt). sha256 recorded in
   `build/ptau16_dev.ptau.sha256`.
3. `keygen`: PTau digest re-checked before every run, then `groth16 setup` +
   `zkey export verificationkey`.
4. `certify`: sha256(r1cs), sha256(wasm), sha256(zkey), keccak256(vk) +
   sha256(vk) → certified `CircuitManifest` in `build/<id>.manifest.json`.
   Re-running the chain reproduces identical digests (proved by tests).

`build/` is gitignored; `.tools/` binaries are committed (platform pinning).

## 5. Engine API (public surface of `@zkpe/engine`)

- `Circuit.load(id)` — integrity-checked handle; throws if artifacts missing
  or manifest digests don't match disk (Security T1).
- `parseCircuitInputs(circuit, raw)` — manifest-driven validation: canonical
  field strings, `u1 ∈ {0,1}`, `u8/u32` ranges, arity; returns normalized
  witness inputs.
- `HashProvider` interface + registry: `registerHashProvider`,
  `getHashProvider`, `getByteHashProvider` (throws `NotSupportedError` for
  field-only providers), `listHashProviders`.
- `PoseidonHashProvider` (id `poseidon`) — matches the certified circuits
  bit-for-bit (asserted against the independent `circomlibjs` oracle);
  `hashBytes` unsupported in v1.
- `prove(circuit, rawInputs)` → `{ proof, publicSignals, task }`,
  `verify(circuit, publicSignals, proof)` → `{ valid, task }`.
- `generateDevKeys`, `verifyDevPtau`, `snarkjsCliPath` — dev key material
  against the checksum-verified PTau.
- `runTask` / `TaskRecord` — audit model (kind, circuit, inputHash, duration,
  status, error) used by prove/verify; basis for the M8 gatekeeper pipeline.
- `npm run bench -w @zkpe/engine` — benchmark harness (below).

## 6. Benchmarks (doc 11 targets, this machine)

snarkjs 0.7.6, circom 2.1.9, bn254, dev ptau16; results in
`packages/circuit-lib/build/bench-m1.json` (gitignored).

| circuit | prove | verify | budget (doc 11) |
|---|---|---|---|
| poseidon-preimage | 44.7 ms | 7.4 ms | ≤3000 / ≤1000 ms |
| merkle-inclusion | 76.4 ms | 6.0 ms | ≤5000 / ≤1000 ms |

## 7. Acceptance evidence (M1 gate)

- `npm run check` green (lint + typecheck + tests).
- 89 tests across the three packages; integration suites run against the
  certified artifacts and are skipped automatically when artifacts are absent.
- Oracle equality: circuit public signals match `circomlibjs` Poseidon
  reference for the same inputs.
- Tamper negatives: corrupted proofs rejected; wrong roots yield `isZero=0`;
  non-binary pathBits rejected; non-canonical fields rejected.
- Deterministic artifacts: `keygen` + `certify` reruns reproduce identical
  hashes.
- Benchmarks within budget (section 6).

## 8. Deliberately deferred (tracked debt)

- Production PTau ceremony (dev PTau is deterministic; crypto review pending).
- `sha256-preimage` circuit (compiler issue, section 3).
- API server / gatekeeper / dashboard (M8+ roadmap).
- `proof-format` envelope signing & key export (M2+).
