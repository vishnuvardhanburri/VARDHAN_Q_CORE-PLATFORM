// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VardhanZKVerifier
 * @notice Minimal on-chain registry for Vardhan Q-Core Platform ZK proof submissions.
 *         Each proof is bound to a receiptId and permanently logged via an event.
 *         Fully permissionless — any authorized node can submit proofs.
 */
contract VardhanZKVerifier {
    event ProofBroadcast(
        bytes32 indexed receiptId,
        uint256 timestamp,
        bytes proofData
    );

    mapping(bytes32 => uint256) public proofTimestamps;

    /**
     * @notice Submit a ZK proof for a given receipt ID.
     * @param receiptId The keccak256 hash of the Vardhan receipt UUID.
     * @param proofData The serialized Groth16 proof + public signals.
     */
    function submitProof(bytes32 receiptId, bytes calldata proofData) external {
        require(proofTimestamps[receiptId] == 0, "Proof already submitted for this receipt");
        proofTimestamps[receiptId] = block.timestamp;
        emit ProofBroadcast(receiptId, block.timestamp, proofData);
    }

    /**
     * @notice Check whether a proof has been submitted for a receipt.
     * @param receiptId The keccak256 hash of the receipt UUID.
     * @return timestamp The block timestamp when the proof was submitted, or 0 if not found.
     */
    function getProofTimestamp(bytes32 receiptId) external view returns (uint256) {
        return proofTimestamps[receiptId];
    }
}
