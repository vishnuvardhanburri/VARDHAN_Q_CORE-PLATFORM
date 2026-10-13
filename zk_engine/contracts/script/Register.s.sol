// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ZKVerifierRegistry} from "../src/ZKVerifierRegistry.sol";

/// @title Register — register an engine-generated proof (integration flow)
/// @dev Registers the proof at fixture index `i` in `fixtures.json`
///      against the deployed registry `proxy`.
///
/// Usage (from contracts/):
///   forge script script/Register.s.sol \
///     --sig 'run(address,string,uint256)' \
///     0x<proxy> test/fixtures/proofs-iv.json 0 \
///     --rpc-url http://127.0.0.1:8547 --broadcast
contract RegisterScript is Script {
    function run(address proxy, string memory fixtureFile, uint256 index) public {
        ZKVerifierRegistry r = ZKVerifierRegistry(proxy);
        string memory raw = vm.readFile(fixtureFile);
        string memory pre = string.concat("$.circuits[", vm.toString(index), "]");

        bytes32 circuitId = vm.parseJsonBytes32(raw, string.concat(pre, ".circuitIdHex"));
        bytes32 vkHash = vm.parseJsonBytes32(raw, string.concat(pre, ".vkHash"));
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

        vm.startBroadcast();
        r.registerProof(circuitId, vkHash, a, b, c, pub);
        vm.stopBroadcast();
        console2.log("REGISTERED", vm.toString(circuitId));
    }
}
