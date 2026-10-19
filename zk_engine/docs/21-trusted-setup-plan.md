# 21 — Trusted-Setup Completion Plan (DEBT-1)

**Status:** Planned (dev regime active; prod ceremony coordinates post-M8)
**Date:** 2026-08-10
**ADR:** ADR-0003 (strategy), ADR-0008 §A1.2 (dev/prod separation)

---

## 1. Purpose

Closes DEBT-1: move production Groth16 key material from the deterministic dev PTau
(`build-ptau.mjs` beacon regime) to a **community Powers of Tau ceremony + per-circuit
phase-2 zkey ceremony**, with the checksum enforcement and vkHash certification already
designed into the engine, registry, and gatekeeper.

The dev regime is not weakened: `build-ptau.mjs` uses a fixed public beacon,
hash-verified on every keygen (M1 acceptance "artifact hashes reproduced in 2 runs") and
`zk prove --env prod` refuses to run without a prod zkey whose SHA-256 matches the
certified checksum (ADR-0003 consequences, engine check).

## 2. Preconditions (stakeholder gate)

- ≥ 1 honest ceremony coordinator + ≥ 2 independent reviewers (T-SETUP assumption, docs/12 §A2).
- Air-gapped machine for zkey generation; slow (async/ring) source of entropy captured before
  the machine is disconnected.
- Registry + gatekeeper live in the target network; allow-list maintainers convened.

## 3. Phase-1: Community PTau acquisition

1. Download the community ceremony output `powersOfTau28_hez_final_28` from the canonical
   distribution point (per ADR-0003 §2).
2. Verify `sha256sum` against the publishable sums file; record it in
   `docs/security/powersOfTau28_hez_final_28.sha256`.
3. Record the attestation in `docs/security/ceremony-log.md` (date, verifier identity,
   checksum, source) — the log is reviewed at the M12 gate.

## 4. Phase-2: Per-circuit zkey ceremony

1. Extend `packages/circuit-lib/scripts/build-ptau.mjs` with a `--prod <ptau-file>` path:
   same hermetic flow (verify → prepare phase2 → beacon → verify), **no fixed dev beacon** —
   entropy from the ceremony device only. The prod path must fail if the PTau checksum is
   not already registered in `docs/security/`.
2. Generate `plonk/zkey` + `vkey` for `poseidon-preimage@1` (first circuit; `merkle-inclusion@1`
   may reuse the same PTau in a second phase-2 round).
3. Record zkey SHA-256 + vkHash in the ceremony log; certify `vkHash` in the gatekeeper
   allow-list (registry stores the leaf; gatekeeper rejects unknown vkHashes — T6 mitigation).
4. Destroy/archive coordinator notes per the no-backup rule; document the archive in the log.

## 5. Engine enforcement (already wired)

| Check | Location |
|-------|----------|
| PTau checksum verified before keygen | `build-ptau.mjs` (dev) + `--prod` (prod) |
| `zk prove --env prod` requires hash-verified prod zkey | engine env gate (`--env prod` path, to land with `build-ptau.mjs --prod`) |
| artifact bundle digest (r1cs/wasm/zkey/vkey) in envelopes | `proof-format` artifactHash (ADR-0012) |
| vkHash allow-list on-chain + gatekeeper | `ZK_VK_ALLOWLIST` / registry |

## 6. Acceptance (M12 gate)

- [ ] PTau checksum recorded + attested by ≥ 2 reviewers
- [ ] prod zkey/vkey generated in hermetic session; hashes in ceremony log
- [ ] `zk prove --env prod` end-to-end on ubuntu-latest (M12 CI job) using the prod key
- [ ] vkHash allow-list updated; registry stores the prod leaf
- [ ] DEBT-1 row in `03-technical-debt-report.md` marked closed

## 7. References

- ADR-0003 (two-tier strategy), ADR-0008 (freeze), ADR-0012 (artifact binding)
- docs/12 §A2 T-SETUP acceptance; docs/07 M12 row ("prod setup MOP")
- `packages/circuit-lib/scripts/build-ptau.mjs`