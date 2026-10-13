// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {
    PausableUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ZKVerifierRegistry} from "../src/ZKVerifierRegistry.sol";
import {RegistryBase} from "./RegistryBase.t.sol";

/// @notice ADR-0010 test double: schema bump by 1 + an added storage field,
///         simulating a migration release.
contract ZKVerifierRegistryV2 is ZKVerifierRegistry {
    uint256 public migratedAt;

    function getSchemaVersion() external pure override returns (uint256) {
        return SCHEMA_VERSION + 1;
    }
}

/// @notice ADR-0010 test double: incompatible schema (same version = patch
///         release is allowed; we use a bogus far-future version to model
///         an invalid target).
contract ZKVerifierRegistryBadSchema is ZKVerifierRegistry {
    function getSchemaVersion() external pure override returns (uint256) {
        return SCHEMA_VERSION + 99;
    }
}

/// @notice Upgrade & emergency-pause behaviour (ADR-0010).
contract UpgradeAndPauseTest is RegistryBase {
    function test_schemaVersionReported() public view {
        assertEq(registry.SCHEMA_VERSION(), 1);
        assertEq(registry.getSchemaVersion(), 1);
    }

    function test_ownerUpgradeToBumpedSchemaRetainsState() public {
        RegistryBase.ProofFixture memory f = poseidonFixture();
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);

        ZKVerifierRegistryV2 v2 = new ZKVerifierRegistryV2();
        vm.prank(admin);
        registry.upgradeToAndCall(address(v2), "");

        assertEq(registry.getSchemaVersion(), 2, "bumped schema live after upgrade");
        assertEq(registry.totalProofs(), 1, "ledger retained across upgrade");
        assertTrue(
            registry.proofLeaves(
                keccak256(abi.encode(POSEIDON_ID, f.vkHash, f.publicInputs, f.a, f.b, f.c))
            )
        );
        (ZKVerifierRegistry.ProofStatus status,) =
            registry.getProofStatus(POSEIDON_ID, publicInputHash(POSEIDON_ID, f.publicInputs));
        assertEq(uint8(status), uint8(ZKVerifierRegistry.ProofStatus.Proved));
    }

    function test_upgrade_rejectsUnsupportedSchema() public {
        ZKVerifierRegistryBadSchema bad = new ZKVerifierRegistryBadSchema();
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(ZKVerifierRegistry.UnsupportedSchemaUpgrade.selector, 1, 100)
        );
        registry.upgradeToAndCall(address(bad), "");
    }

    function test_upgrade_rejectsNonRegistryImplementation() public {
        // A non-contract target is rejected by the ERC-1967 machinery itself.
        vm.prank(admin);
        vm.expectRevert();
        registry.upgradeToAndCall(address(0xbeef), "");
    }

    function test_upgrade_onlyOwner() public {
        ZKVerifierRegistryV2 v2 = new ZKVerifierRegistryV2();
        vm.prank(nonce);
        vm.expectRevert(
            abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, nonce)
        );
        registry.upgradeToAndCall(address(v2), "");
        assertEq(registry.getSchemaVersion(), 1, "upgrade must not have happened");
    }

    function test_pause_blocksRegistration() public {
        RegistryBase.ProofFixture memory f = poseidonFixture();
        vm.prank(admin);
        registry.pause();
        vm.prank(prover);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);

        vm.prank(admin);
        registry.unpause();
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
        assertEq(registry.totalProofs(), 1);
    }

    function test_pause_onlyOwner() public {
        vm.prank(nonce);
        vm.expectRevert(
            abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, nonce)
        );
        registry.pause();
    }

    function test_pause_keepsStatusesReadable() public {
        RegistryBase.ProofFixture memory f = poseidonFixture();
        bytes32 ph = publicInputHash(POSEIDON_ID, f.publicInputs);
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
        vm.prank(admin);
        registry.pause();
        (ZKVerifierRegistry.ProofStatus s,) = registry.getProofStatus(POSEIDON_ID, ph);
        assertEq(uint8(s), uint8(ZKVerifierRegistry.ProofStatus.Proved));
        registry.requireProved(POSEIDON_ID, ph, 0); // gatekeeper still works
    }

    function test_pause_doesNotGateEmergencyMitigation() public {
        // deactivateCircuit is the permanent emergency mitigation and must
        // stay executable while paused (it is owner-gated anyway).
        vm.prank(admin);
        registry.pause();
        vm.prank(admin);
        registry.deactivateCircuit(POSEIDON_ID);
        (,, bool active) = registry.circuits(POSEIDON_ID);
        assertFalse(active, "circuit deactivated while paused");
    }
}
