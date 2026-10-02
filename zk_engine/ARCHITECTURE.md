# 02 — Architecture Review

**Status:** Complete
**Date:** 2026-08-07

---

## 1. Architectural Goal

A production-grade zero-knowledge proof system that:

1. Generates ZK proofs for a defined computation (witness → proof).
2. Verifies proofs on-chain (Ethereum/Solidity).
3. Registers proof anchors in a blockchain registry.
4. Exposes the whole flow through a backend API.
5. Provides a developer CLI, a CI GitHub Action, and a CI/CD gatekeeper.
6. Renders status/exploration via a dashboard.
7. Ships full documentation and end-to-end tests.

## 2. Layered / Component View

The system is organized as an hourglass: a shared **proof format** and **circuit library**
in the middle, fronted by user tooling (CLI, action, API, dashboard) and backed by the
registry (contracts on chain).

```
┌──────────────────────────────────────────────────────────────┐
│   USER SURFACES            Dashboard + Developer CLI + API    │
├──────────────────────────────────────────────────────────────┤
│   AUTOMATION               GitHub Action  →  CI/CD Gatekeeper │
├──────────────────────────────────────────────────────────────┤
│   ZK CORE                  Proof Engine  → Witness Generator  │
│                            →  Proof Verifier (offline/core)   │
├──────────────────────────────────────────────────────────────┤
│   BLOCKCHAIN               Smart Contracts → Blockchain Report │
├──────────────────────────────────────────────────────────────┤
│   COMMON                    Circuit Library + Proof Format     │
└──────────────────────────────────────────────────────────────┘
```

## 3. Component Responsibilities

| Component | Responsibility | Boundary |
|-----------|----------------|----------|
| ZK Proof Engine | Compile circuits → R1CS; build proving/verification keys; run the trusted-setup ceremony parts; orchestrates `groth16` proof generation. | Library, no network access |
| Witness Generator | Compute a valid witness from private+public inputs for a circuit. | Library |
| Proof Verifier | Verify a `proof+ciphertext` against the public vk. On- and off-line variants. | Library + CLI |
| Smart Contracts | Solidity verifier + on-chain registry (store proof hash, owner, status, timestamp). | EVM |
| Blockchain Registry | Verifier/registry binding, and a **gatekeeper** model ("proved" status gate). | EVM |
| Backend API | REST API for circuit read, witness-gen, proof subvention, verification, registry lookup. | HTTP |
| Developer CLI | One-command `zk prove`, `zk verify`, `zk deploy`, `zk status`. Thin over engine + API | TTY |
| GitHub Action | Composite action `zk-verify@v1` distribution of CLI logic in CI | CI |
| CI/CD Gatekeeper | Enforce the "proof must verify before merge/deploy" rule; emits artifacts | CI |
| Dashboard | Explore proofs, circuit dashboards, failure reports. | Web |
| E2E Tests | Prove → verify → deploy → registry → API → dashboard full journey | CI separate job |

## 4. Technology Selection (Options Evaluated)

### 4.1 Proving scheme
| Option | + | – | Verdict |
|--------|---|---|---------|
| **circom 2 + Groth16** | Mature, fast, big community, standard Eth verifiers, excellent docs | Setup ceremony required; Groth16 needs trusted setup per circuit | **Selected** |
| Halo2/Plonk | No trusted setup | more complex, slower, weaker ecosystem on EVM | Alternate for future circuits |

**Selected: circom-2 circuits + snarkjs (Groth16)**. Rationale in ADR-0002.

### 4.2 Language of ZK core / tooling
| Option | Verdict |
|---|---|
| Rust (halo2) | overkill for gatekeeper scope, and Solidity verifier must match; keep circom ecosystem |
| TS/JS core (snarkjs/circom2) | **Selected** – uniform with API/CLI/dashboard, one package story |

### 4.3 Contracts toolchain
| Option | Verdict |
|---|---|
| Foundry (forge) | **Selected** – modern, fast, Solmate + Safe, native fuzzing |
| Hardhat | usable but slower, heavier |

### 4.4 Backend
| Option | Verdict |
|---|---|
| **Fastify + TypeScript** | **Selected** – typed, plugin model, JSON Schema validation, native fast |
| Express | abandoned (no schema validation built-in) |

### 4.5 Monorepo
| Option | Verdict |
|---|---|
| **npm workspaces + turborepo** | **Selected** – proven for many-package repos |
| pnpm workspaces | drop-in alternative |

## 4.6 Numbers and drops. Wait — the plan:

```
packages/
├── circuit-lib/      # circom circuits + compiled artifacts
├── proof-format/     # shared TS types + (de)serialization + hashing
├── engine/           # ZK Proof Engine (prove) + Witness Generator + Verifier
├── contracts/        # Solidity verifier + registry (Foundry)
├── api/              # Fastify backend
├── cli/              # developer CLI
└── dashboard/        # React dashboard
.github/workflows/    # GitHub Action (composite) + CI workflow + gatekeeper
tests/e2e/            # end-to-end journey
docs/                 # documentation, ADRs, roadmap (this directory)
```

## 4. Cross-Cutting Contracts
- End-to-end proof format: `{ vkHash, encryptedWitness?, proof, publicInputs }` defined in `packages/proof-format`.
- The registry is an **append-only** audit ledger keyed by `keccak256(circuitId, publicInputs)`.

## 5. API Surface (proposed)
| Endpoint | Description |
|---|---|
| `POST /api/v1/circuits` | Compile/register a circuit cut |
| `POST /api/v1/witness` | Generate witness for circuit+inputs |
| `POST /api/v1/proofs` | Produce proof (enclave/CLI) |
| `POST /api/v1/proofs/:id/verify` | Verify proof (local verifier) |
| `POST /api/v1/proofs/:id/record` | Submit proof to registry |
| `GET /api/v1/registry/:circuitId` | Fetch ledger entries |

## 6. Boundaries / Trust
- **Private inputs never leave the proving agent** (local CLI or dashboard JS). The API only receives public inputs + proof.
- The on-chain verifier is the **source of truth** for admitted proofs.
- The CI gate **must not** trust a locally-computed "verified=true"; it re-verifies against the Registry API.

## 7. Open Questions for Approval
1. Trusted-setup ceremony approach (Powers of Tau): offline for dev, community ceremony for prod. (ADR-0003)
2. Chain: Ethereum Sepolia vs Polygon Amoy. Decide at Milestone 3.
3. Auth model for backend: API keys vs signed claims — decision ADR-0005.