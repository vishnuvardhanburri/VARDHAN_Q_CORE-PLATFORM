// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {ZKVerifierRegistry} from "../../src/ZKVerifierRegistry.sol";
import {RegistryBase} from "../../test/RegistryBase.t.sol";

/// @notice State-changing "ghost" handler driving the registry for
///         invariant checking (ADR-0004: append-only, forward-only).
/// @dev fail_on_revert = false in foundry.toml: reverting calls are simply
///      skipped by the fuzzer; we track the last observed ledger state in
///      the handler so invariants can assert monotonicity.
contract Handler is RegistryBase {
    uint256 public lastTotalProofs;
    bool public everRegistered;
    bytes32 public lastPublicInputHash;
    uint256 public registerCalls;
    uint256 public tamperCalls;
    uint256 public lifecycleCalls;

    function setUp() public override {
        super.setUp();
        lastTotalProofs = registry.totalProofs();
    }

    /// @notice Register the valid poseidon fixture proof (idempotent).
    function registerValid() public {
        RegistryBase.ProofFixture memory f = poseidonFixture();
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
        registerCalls++;
        everRegistered = true;
        lastPublicInputHash = publicInputHash(POSEIDON_ID, f.publicInputs);
        lastTotalProofs = registry.totalProofs();
    }

    /// @notice Attempt tampered registrations (must always revert).
    function tampered() public {
        RegistryBase.ProofFixture memory f = poseidonFixture();
        f.a[0] ^= 1;
        (bool ok,) = address(registry)
            .call(
                abi.encodeWithSelector(
                    ZKVerifierRegistry.registerProof.selector,
                    POSEIDON_ID,
                    f.vkHash,
                    f.a,
                    f.b,
                    f.c,
                    f.publicInputs
                )
            );
        assertFalse(ok, "tampered proof must never register");
        tamperCalls++;
        lastTotalProofs = registry.totalProofs();
    }

    /// @notice Owner deactivates + re-registers a circuit (forward-only
    ///         lifecycle, existing entries preserved by design).
    function circuitLifecycle() public {
        RegistryBase.ProofFixture memory f = merkleFixture();
        vm.prank(admin);
        registry.deactivateCircuit(MERKLE_ID);
        vm.prank(admin);
        registry.registerCircuit(MERKLE_ID, address(merkleAdapter), f.vkHash);
        lifecycleCalls++;
        lastTotalProofs = registry.totalProofs();
    }
}
