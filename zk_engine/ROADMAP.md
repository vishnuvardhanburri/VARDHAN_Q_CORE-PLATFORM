# Roadmap

This document outlines the 12-to-18-month roadmap for `zk-proof-engine`.

## Current Status (2026 Q3)
- **Completed**: Zero-knowledge proof engine core, canonical proof formats, fastify backend with HMAuth, CLI developer tooling, and smart contracts for registry and verification.
- **Completed**: Supply-chain hardening, OpenSSF Best Practices passing baseline, and automated release signing with Cosign.
- **In Progress**: Horizontal scalability (Redis distributed state, completed via P0 hardening).

## Upcoming Milestones (12-18 Months)

### Q4 2026: Production Network Rollout
- **Goal**: Deploy the ZK registry contracts to a public EVM testnet (e.g., Sepolia) and mainnet.
- **Deliverables**:
  - Mainnet-ready contract compilation with reproducible `CREATE2` salts.
  - Multi-tenant API rate limiting and billing structures.
  - Official Powers of Tau Phase 2 Trusted Setup ceremony (community-driven).

### Q1 2027: Plonk / Halo2 Research & Integration
- **Goal**: Expand the proving engine beyond Groth16 to support Plonk and/or Halo2 for universal setups.
- **Deliverables**:
  - Abstract the circuit interface (ADR update) to decouple from `snarkjs`.
  - Integration of `halo2-wasm` for browser-based proving.
  - Solidity verifiers for Plonk on-chain.

### Q2 2027: Hardware Acceleration & GPU Proving
- **Goal**: Decrease proving latency for large circuits by moving witness generation and FFTs to GPU.
- **Deliverables**:
  - CUDA/Metal backend bindings for the prover engine.
  - Performance benchmarks comparing CPU vs. GPU overhead.
  - CI/CD integration for GPU runners.

### Q3 2027: Privacy-Preserving Proof Delegation
- **Goal**: Allow mobile clients to delegate proving to the engine without revealing private inputs.
- **Deliverables**:
  - Multi-party computation (MPC) based witness delegation.
  - Client SDKs for iOS and Android.

## Prioritization and Feedback
This roadmap is managed by the Maintainers. Community feedback is welcome via GitHub Discussions or Issues. The priorities are subject to change based on security audits and community needs.
