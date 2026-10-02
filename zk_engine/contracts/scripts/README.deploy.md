# Deploying the M4 contract stack

Everything is deployable with a single `forge script`; nothing is ever
deployed by hand. The registry is upgradeable (UUPS, ADR-0010) and is the
**only** stateful contract — verifiers/adapters are immutable once deployed.

## 0. Prerequisites

- Foundry ≥ 1.7 (`foundryup`); submodules already pinned (forge-std,
  openzeppelin-contracts 5.7.0, openzeppelin-contracts-upgradeable 5.7.0).
- A funded account (anvil: any; Sepolia: faucet).
- For Sepolia: `SEPOLIA_RPC_URL`, `PRIVATE_KEY`, `ETHERSCAN_API_KEY`.

## 1. Local (anvil) — 2 minutes

```sh
anvil &
forge test                              # full gate incl. fuzz + invariants
forge script script/Deploy.s.sol \
    --rpc-url http://127.0.0.1:8545 \
    --broadcast
# post-checks:
forge script script/Verify.s.sol \
    --rpc-url http://127.0.0.1:8545 \
    --sig 'run(address)' 0x<proxy-from-broadcast>
```

`Deploy.s.sol` registers the poseidon fixture proof as a deploy-time smoke
(`SMOKE_REGISTER=0` to skip).

## 2. Sepolia (real financing)

```sh
forge script script/Deploy.s.sol \
    --rpc-url "$SEPOLIA_RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --broadcast --slow \
    --verify --etherscan-api-key "$ETHERSCAN_API_KEY" \
    --sender 0x<your-owner-address>
```

`--verify` performs **source verification** on Etherscan for every
deployed contract (proxy, implementation, verifiers, adapters, registry).

### Post-deploy verification (functional)

```sh
forge script script/Verify.s.sol \
    --rpc-url "$SEPOLIA_RPC_URL" \
    --sig 'run(address)' 0x<registry-proxy>
# expects: schemaVersion = 1, both circuits active, matching vkHashes,
#          "VERIFY OK"

# optional: see the fixture anchor live
cast call 0x<proxy> "getProofStatus(bytes32,bytes32)(uint8,uint256)" \
    0x706f736569646f6e2d707265696d616765 ... 
```

Record the proxy + implementation addresses in `docs/14-contracts-design.md`
(deployment register section) and the CHANGELOG with the date.

## 3. Upgrading the registry later (ADR-0010)

```sh
# 1. write V2 (bump SCHEMA_VERSION by ≤1 if layout changes), run the suite
# 2. glean implementation + upgrade:
forge script script/Upgrade.s.sol \
    --rpc-url "$SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY" \
    --broadcast --sig 'run(address)' 0x<new-impl> \
    --verify
# 3. re-run Verify.s.sol; confirm schemaVersion and preserved ledgers.
```

## 4. Notes

- The proof fixtures (`test/fixtures/proofs.json`) are generated with the
  **dev PTau** (`ptau16_dev`) and must be regenerated when the M1 artifacts
  change: `node scripts/gen-proof-fixtures.mjs` then run the full suite.
- vkHash is the canonical keccak of the vkey JSON (fixtures carry the real
  values; do not hand-edit).
- Gas: see `GAS-REPORT.md` — all operations are within budget on L1/L2s.-