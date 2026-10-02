// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {VerifierPoseidonPreimage} from "../src/VerifierPoseidonPreimage.sol";
import {RegistryBase} from "./RegistryBase.t.sol";

/// @notice Regression test pinning the snarkjs→Verifier.sol ABI convention:
///         proof-format's `pi_b` is serialized imaginary-coefficient-first,
///         the generated Groth16 verifier expects real-coefficient-first.
///         Fixtures are normalized to contract order (see
///         scripts/gen-proof-fixtures.mjs), so a misordered `b` must fail.
contract ABIProbeTest is RegistryBase {
    function test_fixtureNormalizedToContractOrder() public {
        RegistryBase.ProofFixture memory f = poseidonFixture();
        VerifierPoseidonPreimage v = new VerifierPoseidonPreimage();
        uint256[1] memory pub = [f.publicInputs[0]];

        assertTrue(v.verifyProof(f.a, f.b, f.c, pub), "canonical ordering must verify");

        uint256[2][2] memory imagFirst = [[f.b[0][1], f.b[0][0]], [f.b[1][1], f.b[1][0]]];
        assertFalse(v.verifyProof(f.a, imagFirst, f.c, pub), "imaginary-first must NOT verify");
    }
}
