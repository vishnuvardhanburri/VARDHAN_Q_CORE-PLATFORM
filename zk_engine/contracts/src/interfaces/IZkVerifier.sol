// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @notice Generic Groth16 verifier interface consumed by ZKVerifierRegistry.
/// @dev Adapters wrap the snarkjs-generated, fixed-arity verifiers so the
///      registry can stay circuit-agnostic (ADR-0004).
interface IZkVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata publicInputs
    ) external view returns (bool);
}
