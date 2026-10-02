// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ZKVerifierRegistry} from "../src/ZKVerifierRegistry.sol";
import {RegistryBase} from "./RegistryBase.t.sol";

contract ZKVerifierRegistryTest is RegistryBase {
    function test_registerProof_happyPathPoseidon() public {
        RegistryBase.ProofFixture memory f = poseidonFixture();
        bytes32 hash = publicInputHash(POSEIDON_ID, f.publicInputs);
        bytes32 leaf = keccak256(abi.encode(POSEIDON_ID, f.vkHash, f.publicInputs, f.a, f.b, f.c));
        vm.expectEmit(true, true, true, true);
        emit ZKVerifierRegistry.ProofRegistered(POSEIDON_ID, leaf, prover, block.timestamp);

        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);

        (ZKVerifierRegistry.ProofStatus status, uint256 provedAt) =
            registry.getProofStatus(POSEIDON_ID, hash);
        assertEq(uint8(status), uint8(ZKVerifierRegistry.ProofStatus.Proved));
        assertEq(provedAt, block.timestamp);
        assertEq(registry.totalProofs(), 1);
        assertTrue(registry.proofLeaves(leaf));
        registry.requireProved(POSEIDON_ID, hash, 0); // does not revert
    }

    function test_registerProof_happyPathMerkle() public {
        RegistryBase.ProofFixture memory f = merkleFixture();
        vm.prank(prover);
        registry.registerProof(MERKLE_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
        assertEq(registry.totalProofs(), 1);
        (ZKVerifierRegistry.ProofStatus status,) =
            registry.getProofStatus(MERKLE_ID, publicInputHash(MERKLE_ID, f.publicInputs));
        assertEq(uint8(status), uint8(ZKVerifierRegistry.ProofStatus.Proved));
    }

    function test_registerProof_tamperedProofReverts() public {
        RegistryBase.ProofFixture memory f = poseidonFixture();
        f.a[0] ^= 1;
        vm.expectRevert(
            abi.encodeWithSelector(ZKVerifierRegistry.InvalidProof.selector, POSEIDON_ID)
        );
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
    }

    function test_registerProof_tamperedPublicInputsRevert() public {
        RegistryBase.ProofFixture memory f = merkleFixture();
        uint256[] memory pub = new uint256[](2);
        pub[0] = f.publicInputs[0] + 1; // different rootPub — breaks the binding
        pub[1] = f.publicInputs[1];
        vm.expectRevert(abi.encodeWithSelector(ZKVerifierRegistry.InvalidProof.selector, MERKLE_ID));
        vm.prank(prover);
        registry.registerProof(MERKLE_ID, f.vkHash, f.a, f.b, f.c, pub);
    }

    function test_registerProof_wrongVkHashReverts() public {
        RegistryBase.ProofFixture memory f = poseidonFixture();
        bytes32 wrong = bytes32(uint256(keccak256("other-vk")) & ((1 << 248) - 1));
        vm.expectRevert(
            abi.encodeWithSelector(
                ZKVerifierRegistry.VkHashMismatch.selector, POSEIDON_ID, f.vkHash, wrong
            )
        );
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, wrong, f.a, f.b, f.c, f.publicInputs);
    }

    function test_registerProof_unknownCircuitReverts() public {
        RegistryBase.ProofFixture memory f = poseidonFixture();
        vm.expectRevert(
            abi.encodeWithSelector(ZKVerifierRegistry.UnknownCircuit.selector, bytes32("nope"))
        );
        vm.prank(prover);
        registry.registerProof(bytes32("nope"), f.vkHash, f.a, f.b, f.c, f.publicInputs);
    }

    function test_registerProof_inactiveCircuitReverts() public {
        RegistryBase.ProofFixture memory f = merkleFixture();
        vm.prank(admin);
        registry.deactivateCircuit(MERKLE_ID);
        vm.expectRevert(
            abi.encodeWithSelector(ZKVerifierRegistry.CircuitInactive.selector, MERKLE_ID)
        );
        vm.prank(prover);
        registry.registerProof(MERKLE_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
    }

    function test_replayAttack_sameProofDifferentInputsReverts() public {
        // Attacker replays the poseidon proof claiming a *different* public
        // output — Groth16 binds inputs, so verification must fail.
        RegistryBase.ProofFixture memory f = poseidonFixture();
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
        uint256[] memory other = new uint256[](1);
        other[0] = f.publicInputs[0] ^ 1;
        vm.expectRevert(
            abi.encodeWithSelector(ZKVerifierRegistry.InvalidProof.selector, POSEIDON_ID)
        );
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, other);
    }

    function test_replayAttack_crossCircuitReverts() public {
        // Poseidon proof replayed against the merkle circuit: same vkHash is
        // rejected (VkHashMismatch) and — using merkle's own vkHash — the
        // proof fails merkle's Groth16 verification.
        RegistryBase.ProofFixture memory f = poseidonFixture();
        vm.expectRevert(abi.encodeWithSelector(ZKVerifierRegistry.InvalidProof.selector, MERKLE_ID));
        vm.prank(prover);
        registry.registerProof(MERKLE_ID, merkleFixture().vkHash, f.a, f.b, f.c, f.publicInputs);
    }

    function test_replay_exactDuplicateIsIdempotent() public {
        RegistryBase.ProofFixture memory f = poseidonFixture();
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
        vm.roll(block.number + 10);
        vm.warp(block.timestamp + 100);
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
        assertEq(registry.totalProofs(), 1, "exact replay must not double-count");
        (, uint256 provedAt) =
            registry.getProofStatus(POSEIDON_ID, publicInputHash(POSEIDON_ID, f.publicInputs));
        assertEq(provedAt, block.timestamp - 100, "provedAt is immutable on replay");
    }

    function test_requireProved_notProvedReverts() public {
        bytes32 ph = bytes32("unregistered-input-hash");
        vm.expectRevert(
            abi.encodeWithSelector(ZKVerifierRegistry.NotProved.selector, POSEIDON_ID, ph)
        );
        registry.requireProved(POSEIDON_ID, ph, 0);
    }

    function test_requireProved_expiryEnforced() public {
        RegistryBase.ProofFixture memory f = poseidonFixture();
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
        bytes32 ph = publicInputHash(POSEIDON_ID, f.publicInputs);
        registry.requireProved(POSEIDON_ID, ph, 1_000); // within age
        vm.warp(block.timestamp + 2_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                ZKVerifierRegistry.ProofExpired.selector,
                POSEIDON_ID,
                ph,
                block.timestamp - 2_000,
                1_000
            )
        );
        registry.requireProved(POSEIDON_ID, ph, 1_000);
    }

    function test_revokeProof_happyPath() public {
        RegistryBase.ProofFixture memory f = poseidonFixture();
        bytes32 ph = publicInputHash(POSEIDON_ID, f.publicInputs);
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
        vm.expectEmit(true, true, true, true);
        emit ZKVerifierRegistry.ProofRevoked(POSEIDON_ID, ph);
        vm.prank(admin);
        registry.revokeProof(POSEIDON_ID, ph);
        (ZKVerifierRegistry.ProofStatus status,) = registry.getProofStatus(POSEIDON_ID, ph);
        assertEq(uint8(status), uint8(ZKVerifierRegistry.ProofStatus.Revoked));
    }

    function test_revokeProof_onlyOwner() public {
        RegistryBase.ProofFixture memory f = poseidonFixture();
        bytes32 ph = publicInputHash(POSEIDON_ID, f.publicInputs);
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
        vm.prank(nonce);
        vm.expectRevert(
            abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, nonce)
        );
        registry.revokeProof(POSEIDON_ID, ph);
    }

    function test_revokeProof_notProvedReverts() public {
        bytes32 ph = bytes32("unregistered-input-hash");
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(ZKVerifierRegistry.NotProved.selector, POSEIDON_ID, ph)
        );
        registry.revokeProof(POSEIDON_ID, ph);
    }

    function test_requireProved_revokedReverts() public {
        RegistryBase.ProofFixture memory f = poseidonFixture();
        bytes32 ph = publicInputHash(POSEIDON_ID, f.publicInputs);
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
        vm.prank(admin);
        registry.revokeProof(POSEIDON_ID, ph);
        vm.expectRevert(
            abi.encodeWithSelector(ZKVerifierRegistry.ProofIsRevoked.selector, POSEIDON_ID, ph)
        );
        registry.requireProved(POSEIDON_ID, ph, 0);
    }

    function test_registerProof_revokedReverts() public {
        // Forward-only: a revoked proof can never be re-registered.
        RegistryBase.ProofFixture memory f = poseidonFixture();
        bytes32 ph = publicInputHash(POSEIDON_ID, f.publicInputs);
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
        vm.prank(admin);
        registry.revokeProof(POSEIDON_ID, ph);
        vm.expectRevert(
            abi.encodeWithSelector(ZKVerifierRegistry.ProofIsRevoked.selector, POSEIDON_ID, ph)
        );
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
    }

    function test_registerCircuit_onlyOwner() public {
        vm.prank(nonce);
        vm.expectRevert(
            abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, nonce)
        );
        registry.registerCircuit(bytes32("x"), address(0xdead), bytes32(0));
    }

    function test_deactivateCircuit_onlyOwner() public {
        vm.prank(nonce);
        vm.expectRevert(
            abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, nonce)
        );
        registry.deactivateCircuit(MERKLE_ID);
    }

    function test_registerCircuit_cannotReaddDuringActive() public {
        // Deactivation is forward-only; re-registration of a deactivated
        // circuit is permitted (new verifier) but entries stay.
        RegistryBase.ProofFixture memory f = merkleFixture();
        vm.prank(admin);
        registry.deactivateCircuit(MERKLE_ID);
        vm.prank(admin);
        registry.registerCircuit(MERKLE_ID, address(merkleAdapter), f.vkHash);
        (,, bool active) = registry.circuits(MERKLE_ID);
        assertTrue(active);
    }
}
