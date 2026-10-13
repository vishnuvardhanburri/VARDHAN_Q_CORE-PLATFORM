// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ProofGatekeeper} from "./ProofGatekeeper.sol";

/// @notice Demo consumer proving ProofGatekeeper's pluggability: a faucet
///         that pays out once per proved proof submission.
contract GatedApp is ProofGatekeeper {
    bytes32 public constant CIRCUIT_ID = bytes32("poseidon-preimage");

    mapping(bytes32 publicInputHash => bool) public paid;
    uint256 public immutable payout;
    uint256 public totalPaid;

    event Paid(address indexed recipient, bytes32 indexed publicInputHash, uint256 amount);

    /// @notice Accept ETH funding so `claim` payouts have balance.
    receive() external payable {}

    constructor(address registry_, uint256 payout_, uint256 proofMaxAge_)
        ProofGatekeeper(registry_, proofMaxAge_)
    {
        payout = payout_;
    }

    /// @notice Claim a payout for a proved proof. Each public-input hash
    ///         can claim once.
    function claim(bytes32 publicInputHash, address payable recipient)
        external
        onlyProved(CIRCUIT_ID, publicInputHash)
    {
        if (recipient == address(0)) revert ZeroRecipient();
        if (paid[publicInputHash]) revert AlreadyPaid(publicInputHash);
        paid[publicInputHash] = true;
        totalPaid += payout;
        recipient.transfer(payout);
        emit Paid(recipient, publicInputHash, payout);
    }

    error AlreadyPaid(bytes32 publicInputHash);
    error ZeroRecipient();
}
