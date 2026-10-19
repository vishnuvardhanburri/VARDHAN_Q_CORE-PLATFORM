# Architecture & Security Gap Report: Cryptographic Reader & Verification Engine

**Repository:** [vishnuvardhanburri/zk-proof-engine](https://github.com/vishnuvardhanburri/zk-proof-engine)  
**Milestone:** Post OpenSSF Gold Baseline (`v1.0.0-gold`)  
**Scope:** `packages/proof-format`, `packages/keys`, `packages/engine`, `packages/circuit-lib`, `packages/api`, `packages/cli`  
**Status:** Pure Audit & Analysis (Zero Code Modifications)  

---

## 1. Executive Summary

Having established a clean, verifiable OpenSSF Gold baseline (`v1.0.0-gold`), the project is now transitioning from governance/supply-chain hardening to building the **core security product**: a strict, fail-closed **Cryptographic Reader** and a unified **Verification Engine**.

This report evaluates the current codebase against the target 5-stage reader pipeline and 6-step verification pipeline. It identifies specific architectural gaps, security boundary weaknesses, and field-validation gaps across all workspace packages.

---

## 2. Cryptographic Reader Architecture & Gap Analysis

### Target Pipeline Model

```text
Artifact / File / Request Body
            │
            ▼
┌──────────────────────────────────────┐
│  1. Cryptographic Reader             │ Enforces max size limits, fail-closed JSON parse
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│  2. Format & Schema Validation       │ Field element bounds check (0 <= x < r), Fr range
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│  3. Cryptographic Metadata Check     │ vkHash, artifactHash, circuitId match manifest
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│  4. Signature Verification (v2)      │ Ed25519 signature over canonical signatureInput
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│  5. Artifact Integrity Verification │ Re-hash on-disk .r1cs, .wasm, .zkey, .vkey
└──────────────────┬───────────────────┘
                   │
                   ▼
           Verification Result
```

### Component Analysis & Gaps

| Stage | Target Capability | Current Implementation | Identified Security / Architecture Gap |
|---|---|---|---|
| **1. Reader & Ingestion** | Fail-closed stream/buffer reader with strict payload size caps (e.g. 2MB max JSON). | Handled ad-hoc via `JSON.parse` in `cli/src/envelope.ts` and Fastify body parser in `api`. | **Gap R1:** No centralized `CryptographicReader` class. Large or malformed JSON payloads can cause CPU exhaustion or unhandled parse exceptions before schema validation. |
| **2. Format & Schema Validation** | Enforce $0 \le x < r$ (BN254 scalar field modulus) on all public inputs and proof coordinates. | `validateEnvelope()` in `proof-format/src/envelope.ts` uses regex pattern matching for field strings. | **Gap R2:** Field elements are validated against regex format, but scalar field modulus overflow ($x \ge r$) is not checked before snarkjs invocation. BigInt range checks must be explicitly enforced in the reader. |
| **3. Metadata Validation** | Validate `vkHash` and `artifactHash` against certified circuit manifests. | Envelopes store `vkHash` and optional `artifactHash`, but validation is optional. | **Gap R3:** `validateEnvelope()` checks string shape, but does not verify that `vkHash` is registered in the trusted manifest registry. `VerifyProofUseCase` in `api` relies purely on `circuitId`. |
| **4. Signature Verification** | Ed25519 signature validation over canonical `signatureInput` for `zk-proof/v2`. | Implemented in `@zkpe/keys` (`verifyEnvelope()`), but not wired into API or CLI verification path. | **Gap R4:** API `/v1/proofs/verify` endpoint accepts raw `ProofSubmission` bodies without enforcing `zk-proof/v2` signature verification when policy requires it. |
| **5. Artifact Integrity** | On-disk SHA-256 verification of compiled `.wasm`, `.zkey`, `.r1cs` files against manifest. | Implemented in `@zkpe/circuit-lib` (`loadArtifactHashes`), but only called at server boot. | **Gap R5:** No runtime integrity check during proof verification to detect on-disk artifact tampering after boot. |

---

## 3. Verification Engine Pipeline & Gap Analysis

### Target Engine Model

```text
Proof Envelope
      │
      ├── 1. Parse & Size Guard
      ├── 2. Structural & Field Validation (0 <= x < r)
      ├── 3. Ed25519 Signature Verification (v2)
      ├── 4. Artifact & vkHash Binding Check
      ├── 5. Groth16 Pairing Verification (snarkjs)
      └── 6. Produce Deterministic Result & Audit Record
```

### Current vs. Target Verification Flow

```text
CURRENT IMPLEMENTATION:
CLI / API ──► validateEnvelope() ──► engine.verify() [snarkjs pairing] ──► Audit Log
(Fragmented across @zkpe/proof-format, @zkpe/keys, and @zkpe/engine)

TARGET IMPLEMENTATION:
CLI / API ──► VerificationEngine.verify(readerResult, policy) ──► Deterministic Result
(Single, atomic, fail-closed orchestrator)
```

### Identified Security & Engineering Gaps

#### Gap E1: Fragmented Pipeline Orchestration
- **Problem:** Currently, callers (CLI, API, Gatekeeper) must manually chain `validateEnvelope()`, `verifyEnvelope()` (for Ed25519 signatures), `computeProofHash()`, and `engine.verify()` (for Groth16 pairing).
- **Risk:** Developers or automation scripts might omit signature verification or `vkHash` binding checks, leading to security bypasses in downstream tools.
- **Remediation:** Create a unified `VerificationEngine` class in `@zkpe/engine` that accepts a `CryptographicReaderResult` and executes all 6 verification stages atomically.

#### Gap E2: Missing Strict Malleability Guards
- **Problem:** `proofHash` is computed over canonicalized envelope fields, but Groth16 proof $A, B, C$ elements are not checked for canonical point representation on the BN254 curve prior to pairing evaluation.
- **Risk:** Proof malleability attacks where altered curve points might yield valid pairings or bypass idempotency stores.
- **Remediation:** Add explicit curve subgroup and canonical coordinate validation in `isValidProofShape()`.

#### Gap E3: API & CLI Disconnect from Certified Verification Keys
- **Problem:** The API endpoint `/v1/proofs/verify` takes `submission.proof` and `submission.publicInputs`, and calls `engine.verify(circuitId, inputs, proof)`. It does not compare the submitted `vkHash` against the server's certified `vkHash`.
- **Risk:** A client could submit a valid proof generated against a malicious or uncertified verification key if the API engine holds multiple key versions.
- **Remediation:** Enforce that `submission.vkHash === certifiedCircuit.manifest.vkHash` prior to snarkjs pairing execution.

---

## 4. Proposed Implementation Architecture

To resolve these gaps cleanly without architectural bloat, we propose adding two new modules in subsequent engineering phases:

### Package `packages/proof-format`:
1. `src/reader.ts` — **`CryptographicReader`**:
   - `readBuffer(buffer: Uint8Array, options?: ReaderOptions): ReaderResult`
   - `readStream(stream: Readable, options?: ReaderOptions): ReaderResult`
   - Enforces 2MB max payload cap, strict UTF-8 decoding, JSON depth bounds, scalar field range checks ($0 \le x < r$).

### Package `packages/engine`:
2. `src/verification-engine.ts` — **`VerificationEngine`**:
   - Atomic verification pipeline executing Reader Validation → Signature Verification → `vkHash` Binding → Groth16 Pairing → Deterministic Audit Record.

---

## 5. Next Steps for Implementation (Phased Roadmap)

1. **Phase 2 (Next Milestone):** Implement `CryptographicReader` in `@zkpe/proof-format` with strict fail-closed field bounds ($0 \le x < r$) and payload size guards.
2. **Phase 3:** Implement unified `VerificationEngine` in `@zkpe/engine` uniting envelope validation, Ed25519 signature verification, `vkHash` binding, and Groth16 pairing.
3. **Phase 4:** Harden with fuzzing (`fast-check`), security regression tests, and failure injection.
4. **Phase 5:** Independent Security Audit & Production Release.
