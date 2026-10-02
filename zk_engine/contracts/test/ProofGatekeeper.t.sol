// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {ZKVerifierRegistry} from "../src/ZKVerifierRegistry.sol";
import {ProofGatekeeper} from "../src/ProofGatekeeper.sol";
import {GatedApp} from "../src/GatedApp.sol";
import {RegistryBase} from "./RegistryBase.t.sol";

contract GatedAppTest is RegistryBase {
    GatedApp app;
    address payable recipient;

    function setUp() public override {
        super.setUp();
        vm.deal(address(0xdead), 100 ether);
        app = new GatedApp(address(registry), 1 ether, 0); // no expiry
        vm.deal(address(app), 100 ether);
        recipient = payable(makeAddr("recipient"));
    }

    function test_claim_afterProvedProof() public {
        RegistryBase.ProofFixture memory f = poseidonFixture();
        bytes32 ph = publicInputHash(POSEIDON_ID, f.publicInputs);
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);

        uint256 balanceBefore = recipient.balance;
        vm.prank(prover);
        app.claim(ph, recipient);
        assertEq(recipient.balance, balanceBefore + 1 ether);
        assertTrue(app.paid(ph));
        assertEq(app.totalPaid(), 1 ether);
    }

    function test_claim_withoutProofReverts() public {
        bytes32 ph = bytes32("no-such-input");
        vm.expectRevert(
            abi.encodeWithSelector(
                ProofGatekeeper.OnlyProved.selector, bytes32("poseidon-preimage"), ph
            )
        );
        vm.prank(prover);
        app.claim(ph, recipient);
    }

    function test_claim_onlyOnce() public {
        RegistryBase.ProofFixture memory f = poseidonFixture();
        bytes32 ph = publicInputHash(POSEIDON_ID, f.publicInputs);
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
        vm.prank(prover);
        app.claim(ph, recipient);
        vm.expectRevert(abi.encodeWithSelector(GatedApp.AlreadyPaid.selector, ph));
        vm.prank(prover);
        app.claim(ph, recipient);
    }

    function test_claim_expiredProofReverts() public {
        GatedApp expiring = new GatedApp(address(registry), 1 ether, 100);
        RegistryBase.ProofFixture memory f = poseidonFixture();
        bytes32 ph = publicInputHash(POSEIDON_ID, f.publicInputs);
        vm.prank(prover);
        registry.registerProof(POSEIDON_ID, f.vkHash, f.a, f.b, f.c, f.publicInputs);
        vm.warp(block.timestamp + 101);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProofGatekeeper.OnlyProved.selector, bytes32("poseidon-preimage"), ph
            )
        );
        vm.prank(prover);
        expiring.claim(ph, recipient);
    }
}
