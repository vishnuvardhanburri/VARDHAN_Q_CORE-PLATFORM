// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IZkVerifier} from "./interfaces/IZkVerifier.sol";
import {VerifierPoseidonPreimage} from "./VerifierPoseidonPreimage.sol";

/// @notice Adapter exposing the generic IZkVerifier shape over the
///         snarkjs-generated `poseidon-preimage` verifier (1 public signal).
contract VerifierPoseidonPreimageAdapter is IZkVerifier {
    VerifierPoseidonPreimage public immutable verifier;

    constructor(address verifier_) {
        verifier = VerifierPoseidonPreimage(verifier_);
    }

    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata publicInputs
    ) external view returns (bool) {
        if (publicInputs.length != 1) return false;
        uint256[1] memory signals = [publicInputs[0]];
        return verifier.verifyProof(a, b, c, signals);
    }
}
