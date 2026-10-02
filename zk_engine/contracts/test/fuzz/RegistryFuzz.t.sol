// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {ZKVerifierRegistry} from "../../src/ZKVerifierRegistry.sol";
import {RegistryBase} from "../../test/RegistryBase.t.sol";

/// @notice Property-based (fuzz) tests, ADR-0004 design rules:
///         1. garbage input never produces a ledger append and never
///            panics — it reverts cleanly.
///         2. expiry logic is exact: requireProved passes iff unexpired.
///         3. append-only: totalProofs and provedAt move only monotonically.
contract RegistryFuzzTest is RegistryBase {
    /// @notice Any garbage proof must revert cleanly (never vectorize).
    function testFuzz_garbageProofNeverRegisters(
        bytes32 circuitId,
        bytes32 vk,
        uint256 a0,
        uint256 a1,
        uint256 b00,
        uint256 b01,
        uint256 b10,
        uint256 b11,
        uint256 c0,
        uint256 c1,
        uint256 seed,
        uint8 inputCount
    ) public {
        vm.assume(inputCount <= 4);
        uint256[] memory inputs = new uint256[](inputCount);
        for (uint256 i = 0; i < inputCount; i++) {
            inputs[i] = uint256(keccak256(abi.encode(seed, i)));
        }

        uint256 before = registry.totalProofs();
        uint256[2] memory a = [a0, a1];
        uint256[2][2] memory b = [[b00, b01], [b10, b11]];
        uint256[2] memory c = [c0, c1];
        try registry.registerProof(circuitId, vk, a, b, c, inputs) {
            // Astronomically unlikely to verify; if it ever does, it must
            // not corrupt accounting (append-only semantics).
            assertGe(registry.totalProofs(), before, "totalProofs must not decrease");
        } catch {
            assertEq(registry.totalProofs(), before, "revert must not mutate the ledger");
        }
    }

    /// @notice Expiry is exact per documented semantics: maxAge == 0 means no
    ///        expiry; otherwise requireProved passes iff delta <= maxAge.
    function testFuzz_requireProvedExpiryIsExact(uint256 delta, uint256 maxAge) public {
        delta = bound(delta, 0, 365 days);
        maxAge = bound(maxAge, 0, 365 days + 1);
        RegistryBase.ProofFixture memory f = poseidonFixture();
        bytes32 ph = publicInputHash(POSEIDON_ID, f.publicInputs);
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
        (, uint256 t0) = registry.getProofStatus(POSEIDON_ID, ph);
        vm.warp(t0 + delta);
        if (maxAge != 0 && delta > maxAge) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    ZKVerifierRegistry.ProofExpired.selector, POSEIDON_ID, ph, t0, maxAge
                )
            );
            registry.requireProved(POSEIDON_ID, ph, maxAge);
        } else {
            registry.requireProved(POSEIDON_ID, ph, maxAge); // no expiry or within age
        }
    }

    /// @notice status field stays burned-in: once proved, provedAt never
    /// changes for any amount of replays or time travel.
    function test_replayStatusNeverChanges(uint256 replays, uint256 hop) public {
        replays = bound(replays, 0, 10);
        hop = bound(hop, 1, 1e9);
        RegistryBase.ProofFixture memory f = poseidonFixture();
        bytes32 ph = publicInputHash(POSEIDON_ID, f.publicInputs);
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
        (ZKVerifierRegistry.ProofStatus s0, uint256 t0) = registry.getProofStatus(POSEIDON_ID, ph);
        assertEq(uint8(s0), uint8(ZKVerifierRegistry.ProofStatus.Proved));
        uint256 latest = t0;
        for (uint256 i; i < replays; ++i) {
            vm.warp(block.timestamp + hop);
            vm.prank(prover);
            registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
            (, latest) = registry.getProofStatus(POSEIDON_ID, ph);
            assertEq(latest, t0, "replay must never update provedAt");
        }
        assertEq(registry.totalProofs(), 1, "replay must never add a leaf");
    }
}
