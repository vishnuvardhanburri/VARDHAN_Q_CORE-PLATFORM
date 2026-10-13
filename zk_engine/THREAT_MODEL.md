# Threat Model

This document outlines the security architecture and threat model for `zk-proof-engine`.

## 1. System Boundaries & Trust Assumptions

### 1.1 Prover (Client)
- **Trust Level**: Untrusted.
- **Responsibility**: Computes the witness and generates the Groth16 proof.
- **Assumptions**: The client holds the private inputs. If the client is compromised, private inputs may be exposed. The server *never* receives private inputs, only the public inputs and the proof.

### 1.2 Verifier API (Server)
- **Trust Level**: Trusted by the application, but must assume hostile clients.
- **Responsibility**: Validates proof envelopes, verifies cryptographic proofs against known Verification Keys (VKs), and anchors results to the blockchain registry.
- **Assumptions**: The server infrastructure (API, Redis, Keys) is secure. The server must fail closed if validation, rate-limiting, or verification fails.

### 1.3 Smart Contracts (Blockchain)
- **Trust Level**: Trusted execution environment.
- **Responsibility**: Acts as the immutable, append-only registry of verified proofs.
- **Assumptions**: The underlying EVM network is secure. The smart contracts are upgradeable via UUPS, with upgrade authority tightly restricted.

## 2. Identified Threats & Mitigations

### 2.1 Cryptographic Attacks
| Threat | Description | Mitigation |
|--------|-------------|------------|
| **Forged Proofs** | Attacker submits a mathematically invalid proof that the verifier accepts. | We strictly use `snarkjs` Groth16 verifiers which check pairing equations over BN254. Verification keys are canonically hashed (`vkHash`) and allow-listed. |
| **Malleability** | Attacker modifies an existing proof slightly to bypass idempotency or create a duplicate. | The API enforces strict schema validation and requires a canonical `proofHash`. The blockchain registry prevents duplicate registration of the same `(circuitId, publicInputs)` tuple. |
| **Toxic Waste** | Attacker reconstructs the private inputs because the trusted setup was compromised. | We require a multi-party Powers of Tau ceremony. (Currently in development; local setups are for testing only). |

### 2.2 Application / API Attacks
| Threat | Description | Mitigation |
|--------|-------------|------------|
| **Replay Attacks** | Attacker resubmits a valid API request to trigger duplicate actions. | All authenticated requests require a canonical HMAC-SHA256 signature, a strict timestamp TTL (default 5 mins), and a globally unique, single-use nonce tracked in Redis. |
| **Resource Exhaustion (DoS)** | Attacker floods the API with complex proof verification requests. | The API enforces a strict concurrency limit (`Semaphore`) on CPU-intensive `snarkjs` calls. Redis-backed rate limiting is implemented on all endpoints. |
| **Tenant Isolation Breach** | Tenant A accesses or overwrites Tenant B's proof jobs. | Tenant IDs are securely derived from the authenticated API key (server-side). Client-provided tenant IDs in payloads are explicitly ignored/overwritten. |

### 2.3 Supply Chain Attacks
| Threat | Description | Mitigation |
|--------|-------------|------------|
| **Dependency Confusion / Malicious Packages** | Attacker publishes a malicious package that gets pulled during build. | We use `npm ci` with a strict `package-lock.json`. Dependencies are scanned via `npm audit` and OSV-Scanner. |
| **Artifact Tampering** | Attacker modifies the release binary on GitHub. | All release artifacts (`.tar.gz`, `sbom.json`) are signed using Sigstore (Cosign) and include SLSA Build Provenance. |

## 3. Reporting Security Issues
For instructions on how to report a vulnerability privately, please refer to our [SECURITY.md](SECURITY.md).
