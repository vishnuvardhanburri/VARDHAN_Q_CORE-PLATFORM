// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ZKVerifierRegistry} from "../src/ZKVerifierRegistry.sol";

/// @title Verify — post-deployment verification (read-only)
/// @notice Loads a deployed registry (proxy address) and asserts the
///         invariants an operator must check after every deploy/upgrade:
///         1. schema version matches the live implementation's constant;
///         2. both circuits are active with the canonical vkHashes
///            (fixtures carry the ADR-0008 canonical values);
///         3. totalProofs is printable for drift checks.
///
/// @dev Usage:
///   forge script script/Verify.s.sol \
///     --rpc-url $SEPOLIA_RPC_URL \
///     --sig 'run(address)' 0x<registry-proxy>
///   Read-only — safe to run repeatedly; no broadcast.
contract VerifyScript is Script {
    function run(address registryProxy) public {
        ZKVerifierRegistry r = ZKVerifierRegistry(registryProxy);
        require(r.getSchemaVersion() == r.SCHEMA_VERSION(), "schema drift");

        string memory raw = vm.readFile("test/fixtures/proofs.json");
        bytes32 poseidonVkHash = vm.parseJsonBytes32(raw, "$.circuits[0].vkHash");
        bytes32 merkleVkHash = vm.parseJsonBytes32(raw, "$.circuits[1].vkHash");

        (address vp, bytes32 vkP, bool aP) = r.circuits(bytes32("poseidon-preimage"));
        (address vM, bytes32 vkM, bool aM) = r.circuits(bytes32("merkle-inclusion"));
        require(vp != address(0) && aP, "poseidon circuit not active");
        require(vM != address(0) && aM, "merkle circuit not active");
        require(vkP == poseidonVkHash, "poseidon vkHash mismatch");
        require(vkM == merkleVkHash, "merkle vkHash mismatch");

        console2.log("schemaVersion =", r.getSchemaVersion());
        console2.log("totalProofs =", r.totalProofs());
        console2.log("VERIFY OK");
    }
}
