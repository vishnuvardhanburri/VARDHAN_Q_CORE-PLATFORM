// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ZKVerifierRegistry} from "../src/ZKVerifierRegistry.sol";
import {VerifierPoseidonPreimage} from "../src/VerifierPoseidonPreimage.sol";
import {VerifierPoseidonPreimageAdapter} from "../src/VerifierPoseidonPreimageAdapter.sol";
import {VerifierMerkleInclusion} from "../src/VerifierMerkleInclusion.sol";
import {VerifierMerkleInclusionAdapter} from "../src/VerifierMerkleInclusionAdapter.sol";

/// @title Deploy — full M4 contract stack (anvil, Sepolia, or any L2)
/// @dev Script runtime supports deployment + functional smoke verification.
///
/// Usage:
///   local  : forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
///   sepolia: forge script script/Deploy.s.sol \
///              --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY \
///              --broadcast --slow --verify --etherscan-api-key $ETHERSCAN_API_KEY
///   See scripts/README.deploy.md for the complete procedure and
///   post-deploy registry checks.
///
/// Env knobs (all optional):
///   OWNER_ADDRESS — owner of the registry (default: the broadcaster).
///   SMOKE_REGISTER — "1" to register the fixture proof post-deploy
///                    (default: 1 on testnets/anvil, 0 otherwise).
contract DeployScript is Script {
    ZKVerifierRegistry public registry;
    address public registryProxy;
    address public implementation;
    address public poseidonAdapter;
    address public merkleAdapter;

    function run() public {
        string memory raw = vm.readFile("test/fixtures/proofs.json");
        bytes32 poseidonVkHash = vm.parseJsonBytes32(raw, "$.circuits[0].vkHash");
        bytes32 merkleVkHash = vm.parseJsonBytes32(raw, "$.circuits[1].vkHash");

        address owner = vm.envExists("OWNER_ADDRESS") ? vm.envAddress("OWNER_ADDRESS") : msg.sender;
        bool smoke = vm.envExists("SMOKE_REGISTER") ? vm.envBool("SMOKE_REGISTER") : true;

        vm.startBroadcast();
        implementation = address(new ZKVerifierRegistry());
        registryProxy = address(
            new ERC1967Proxy(implementation, abi.encodeCall(ZKVerifierRegistry.initialize, (owner)))
        );
        registry = ZKVerifierRegistry(registryProxy);

        poseidonAdapter =
            address(new VerifierPoseidonPreimageAdapter(address(new VerifierPoseidonPreimage())));
        merkleAdapter =
            address(new VerifierMerkleInclusionAdapter(address(new VerifierMerkleInclusion())));

        registry.registerCircuit(bytes32("poseidon-preimage"), poseidonAdapter, poseidonVkHash);
        registry.registerCircuit(bytes32("merkle-inclusion"), merkleAdapter, merkleVkHash);

        if (smoke) {
            registerFixtureProof(0, bytes32("poseidon-preimage"), poseidonVkHash, raw);
            console2.log("SMOKE OK: poseidon fixture proof registered");
        }
        vm.stopBroadcast();

        console2.log("ZKVerifierRegistry (proxy):", registryProxy);
        console2.log("implementation:", implementation);
        console2.log("poseidon adapter:", poseidonAdapter);
        console2.log("merkle adapter:", merkleAdapter);
        console2.log("owner:", owner);
    }

    /// @dev Registers fixture `i` on-chain — the deploy-time functional
    ///      verification step (reuses the exact calldata shape that the
    ///      test suite asserts against the same artifacts).
    function registerFixtureProof(uint256 i, bytes32 circuitId, bytes32 vkHash, string memory raw)
        internal
    {
        string memory pre = string.concat("$.circuits[", vm.toString(i), "]");
        uint256[2] memory a = [
            vm.parseJsonUint(raw, string.concat(pre, ".a[0]")),
            vm.parseJsonUint(raw, string.concat(pre, ".a[1]"))
        ];
        uint256[2][2] memory b = [
            [
                vm.parseJsonUint(raw, string.concat(pre, ".b[0]")),
                vm.parseJsonUint(raw, string.concat(pre, ".b[1]"))
            ],
            [
                vm.parseJsonUint(raw, string.concat(pre, ".b[2]")),
                vm.parseJsonUint(raw, string.concat(pre, ".b[3]"))
            ]
        ];
        uint256[2] memory c = [
            vm.parseJsonUint(raw, string.concat(pre, ".c[0]")),
            vm.parseJsonUint(raw, string.concat(pre, ".c[1]"))
        ];
        uint256[] memory pub = vm.parseJsonUintArray(raw, string.concat(pre, ".publicInputs"));
        registry.registerProof(circuitId, vkHash, a, b, c, pub);
    }
}
