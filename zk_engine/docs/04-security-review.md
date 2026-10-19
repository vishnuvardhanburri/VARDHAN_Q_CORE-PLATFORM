# 04 — Security Review

**Status:** Complete
**Date:** 2026-08-07

---

## 1. Scope

Threat model for the greenfield ZK system: prover-side (circuit, witness, keys), network
(API, CLI, action), on-chain (contracts, registry), and CI/CD (gatekeeper). This review is
input to the design; each finding maps to a design requirement enforced in a milestone.

## 2. Assets

| Asset | Confidentiality | Integrity | Availability |
|-------|-----------------|-----------|--------------|
| Private inputs (witness secrets) | HIGH | HIGH | n/a |
| Proving keys (`.zkey`) | n/a (public) | HIGH (tamper = broken proofs) | MED |
| Verification keys (`.vkey`) | n/a | HIGH | MED |
| PTau ceremony files | n/a | HIGH (poisoned setup = forgeable proofs) | n/a |
| On-chain registry state | n/a | HIGH | MED |
| API signing secret | HIGH | HIGH | n/a |
| CI credentials (deploy keys) | HIGH | HIGH | n/a |

## 3. Threats & Mitigations (mapped to requirements)

| # | Threat | Likelihood | Impact | Mitigation (design req) | Milestone |
|---|--------|-----------|--------|--------------------------|-----------|
| T1 | Malicious circuit/proving-key substitution in supply chain | MED | CRITICAL | Pin & hash all artifacts (PTau checksums, zkey hash in registry); compile from source in CI | M1, M6 |
| T2 | Private inputs leaked via API/dashboard logs | MED | HIGH | Private inputs only on prover side; API schema rejects private fields; structured logging redacts; never log inputs | M2, M5 |
| T3 | Proof replay (reuse of proof across registry entries) | HIGH | MED | Registry keys by `keccak256(circuitId, publicInputs)`; proof includes nullifier where circuit requires | M4 |
| T4 | Forged verification result at API layer | MED | HIGH | API never reports verify=true without on-chain or local-cryptographic verification; verifier uses trusted `vkHash` | M5 |
| T5 | Contract reentrancy / registry write manipulation | LOW | HIGH | Registry is append-only; checks-effects-interactions; Foundry fuzz tests; no external calls in registry writes | M4 |
| T6 | Trusted-setup poisoning (dev PTau reused in prod) | LOW | CRITICAL | Separate dev/prod PTau; prod requires community ceremony (DEBT-1); zkey generation hermetic | M1 |
| T7 | CI/CD gate bypass (skip-proof merge) | MED | HIGH | Branch protection + gatekeeper job required status; proof artifact hash attached to PR comment | M7, M8 |
| T8 | API DoS via expensive proof verification | MED | MED | Rate limiting, job queue, cost-capped verification, async verify endpoints | M5 |
| T9 | Dashboard XSS (proof data rendered as HTML) | MED | MED | React escapes by default; no `dangerouslySetInnerHTML`; CSP headers | M9 |
| T10 | Secrets in env files committed | HIGH | LOW | `.env*` ignored; `git-secrets` style CI scan (Milestone 8) | M0 |

## 4. Crypto Requirements

1. **Curve**: BN254 (alt_bn128) — native precompiles on EVM (`ecpairing`).
2. **Hash**: keccak256 for registry keys; Poseidon inside circuits.
3. **Signature (API)**: HMAC-SHA256 request signing or per-request nonce; ADR-0005.
4. **Keys**: proving keys never exposed over the network; generated where used.
5. **Versioning**: every proof embeds `circuitVersion` and `vkHash`; verifier enforces
   allowed-version list.

## 5. Security Tooling Roadmap

| Milestone | Tooling |
|-----------|---------|
| M0 | `.gitignore`, secret scan (hard gate, gitleaks 8.16.1) in CI |
| M1 | `npm audit` gate on dependencies |
| M4 | Foundry `forge test` with fuzz + invariants; `slither` scan on contracts |
| M5 | Rate limiting; Zod schema validation on all API inputs; CORS allowlist |
| M7 | GitHub Action pins to SHA; `actions/checkout@<sha>` style |
| M8 | Gatekeeper: signature check on proof artifact; secret scan in PRs |
| M9 | CSP + `helmet`-style headers; dependency audit in dashboard |
| M12 | External audit checklist; `snyk`/`osv-scanner` full-scan |

## 6. Acceptable-Risk Registry (post-milestone review points)

- API-key auth without KMS until DEBT-4 is scheduled.
- Dashboard shows proofs but never private inputs (by construction).
- dev PTau used only in non-mainnet deployments.

## 7. Verdict

With the mitigations above applied in the listed milestones, the architecture is
acceptable for a v1 gatekeeper system. The two non-negotiable items are T1 (artifact
pinning) and T6 (setup separation).