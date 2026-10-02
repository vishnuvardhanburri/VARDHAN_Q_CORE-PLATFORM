// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {GatedApp} from "../src/GatedApp.sol";

/// @title DeployGated — deploy the gatekeeper demo consumer bound to a
///         registry proxy (integration flow step 5).
contract DeployGated is Script {
    function run(address registryProxy) public {
        vm.startBroadcast();
        GatedApp app = new GatedApp(registryProxy, 1 ether, 0);
        payable(address(app)).transfer(1 ether);
        vm.stopBroadcast();
        console2.log("GatedApp", address(app));
    }
}
