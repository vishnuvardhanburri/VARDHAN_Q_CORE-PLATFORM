// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IZkVerifier} from "./interfaces/IZkVerifier.sol";
import {VerifierMerkleInclusion} from "./VerifierMerkleInclusion.sol";

/// @notice Adapter exposing the generic IZkVerifier shape over the
///         snarkjs-generated `merkle-inclusion` verifier (2 public signals:
///         rootPub, isZero).
contract VerifierMerkleInclusionAdapter is IZkVerifier {
    VerifierMerkleInclusion public immutable verifier;

    constructor(address verifier_) {
        verifier = VerifierMerkleInclusion(verifier_);
    }

    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata publicInputs
    ) external view returns (bool) {
        if (publicInputs.length != 2) return false;
        uint256[2] memory signals = [publicInputs[0], publicInputs[1]];
        return verifier.verifyProof(a, b, c, signals);
    }
}
