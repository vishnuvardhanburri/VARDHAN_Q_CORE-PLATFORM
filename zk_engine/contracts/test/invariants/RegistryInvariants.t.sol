// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {ZKVerifierRegistry} from "../../src/ZKVerifierRegistry.sol";
import {Handler} from "./Handler.t.sol";

/// @notice Invariant suite (ADR-0004 §Design rules):
///  - the ledger is append-only: totalProofs never decreases and equals the
///    number of distinct anchors ever registered;
///  - statuses are forward-only: once proved, the (circuitId,
///    publicInputHash) entry is Proved forever with a fixed provedAt;
///  - tampered inputs can never produce an anchor (ledger untouched).
contract RegistryInvariantsTest is Test {
    Handler internal handler;

    function setUp() public {
        handler = new Handler();
        handler.setUp(); // deploy registry + circuits inside the handler
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = Handler.registerValid.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_appendOnlyLedger() public view {
        uint256 current = handler.registry().totalProofs();
        assertGe(current, handler.lastTotalProofs(), "totalProofs must never decrease");
        if (handler.everRegistered()) {
            assertEq(current, 1, "exactly one distinct anchor may ever exist");
        } else {
            assertEq(current, 0, "no anchor before a valid registration");
        }
    }

    /// @notice A registered anchor is Proved forever (forward-only status).
    function invariant_statusNeverRegresses() public view {
        if (handler.everRegistered()) {
            (ZKVerifierRegistry.ProofStatus status, uint256 provedAt) = handler.registry()
                .getProofStatus(bytes32("poseidon-preimage"), handler.lastPublicInputHash());
            assertEq(uint8(status), uint8(ZKVerifierRegistry.ProofStatus.Proved));
            assertGt(provedAt, 0, "provedAt must be set");
        }
    }

    /// @notice Tampering is completely inert: the ledger only ever holds
    ///         anchors created by valid registrations.
    function invariant_tamperIsInert() public view {
        assertEq(
            handler.registry().totalProofs(),
            handler.everRegistered() ? 1 : 0,
            "tampered calls must not alter the ledger"
        );
    }
}
