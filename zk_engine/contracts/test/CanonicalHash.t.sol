// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";

/// @title CanonicalHash — cross-language anchor regression (Solidity side)
/// @notice Pins chain-side `keccak256(abi.encode(publicInputs))` to
///         `test/fixtures/canonical-vectors.json`, the single source of
///         truth generated from Solidity's own abi.encode. TypeScript side
///         (`packages/proof-format/test/abi.test.ts`) asserts the SAME file;
///         any divergence between the languages fails one of the two suites.
/// @dev Regenerate the spec: forge test --match-contract CanonicalVectorsGen -vvvv
contract CanonicalHashTest is Test {
    string constant SPEC = "test/fixtures/canonical-vectors.json";

    function testCanonicalAnchorsMatchSolidityAbi() public {
        string memory raw = vm.readFile(SPEC);
        for (uint256 i = 0; i < 5; i++) {
            string memory pre = string.concat("$.vectors[", vm.toString(i), "]");
            uint256[] memory values = vm.parseJsonUintArray(raw, string.concat(pre, ".values"));
            bytes32 expected = vm.parseJsonBytes32(raw, string.concat(pre, ".hash"));
            assertEq(
                keccak256(abi.encode(values)),
                expected,
                string.concat("canonical anchor mismatch at vector ", vm.toString(i))
            );
        }
    }

    function testSpecIsWellFormed() public {
        string memory raw = vm.readFile(SPEC);
        uint256[] memory n = vm.parseJsonUintArray(raw, "$.vectors[4].values");
        assertEq(n.length, 2, "spec vector 4 must be the 2-element pair");
        assertEq(
            keccak256(abi.encode(n)),
            0x9f6376d7a93614c6c3d937639f6989d87eea64bd1d049e4b442da29aba51a732
        );
    }

    /// @notice Pins the proof leaf ZKVerifierRegistry.registerProof stores —
    ///         keccak256(abi.encode(circuitId, vkHash, publicInputs, a, b, c))
    ///         — to the same spec file the TypeScript side asserts, guarding
    ///         the exact on-chain proof binding (hardening M10): any drift in
    ///         field order, G2 layout, or padding fails here.
    function testProofRecordLeavesMatchRegistryAbi() public {
        string memory raw = vm.readFile(SPEC);
        for (uint256 i = 0; i < 3; i++) {
            string memory pre = string.concat("$.proofRecords[", vm.toString(i), "]");
            bytes32 id = bytes32(bytes(vm.parseJsonString(raw, string.concat(pre, ".circuitId"))));
            bytes32 vkHash = vm.parseJsonBytes32(raw, string.concat(pre, ".vkHash"));
            uint256[] memory pi = vm.parseJsonUintArray(raw, string.concat(pre, ".publicInputs"));
            uint256[] memory aJson = vm.parseJsonUintArray(raw, string.concat(pre, ".a"));
            uint256[][] memory bJson =
                abi.decode(vm.parseJson(raw, string.concat(pre, ".b")), (uint256[][]));
            uint256[] memory cJson = vm.parseJsonUintArray(raw, string.concat(pre, ".c"));
            bytes memory enc = vm.parseBytes(vm.parseJsonString(raw, string.concat(pre, ".enc")));
            bytes32 expected = vm.parseJsonBytes32(raw, string.concat(pre, ".hash"));

            uint256[2] memory a = [aJson[0], aJson[1]];
            uint256[2][2] memory b;
            b[0] = [bJson[0][0], bJson[0][1]];
            b[1] = [bJson[1][0], bJson[1][1]];
            uint256[2] memory c = [cJson[0], cJson[1]];

            bytes memory actual = abi.encode(id, vkHash, pi, a, b, c);
            assertEq(keccak256(actual), keccak256(enc), "proof record encoding drift");
            assertEq(
                keccak256(actual),
                expected,
                string.concat("proof record leaf mismatch at vector ", vm.toString(i))
            );
        }
    }

    /// @notice Pins the live CLI proof (decimal-string JSON, snarkjs layout)
    ///         to the leaf the registry stored on anvil for that exact proof:
    ///         0xa806982c…e5. TypeScript asserts the same anchor from the same
    ///         fixture — the single canonical proofHash for one proof file.
    function testLiveCliDecimalProofLeafMatchesRegistryAnchor() public view {
        string memory raw = vm.readFile(SPEC);
        string memory pre = "$.proofRecords[2]";
        bytes32 id = bytes32(bytes(vm.parseJsonString(raw, string.concat(pre, ".circuitId"))));
        bytes32 vkHash = vm.parseJsonBytes32(raw, string.concat(pre, ".vkHash"));
        uint256[] memory pi = vm.parseJsonUintArray(raw, string.concat(pre, ".publicInputs"));
        uint256[] memory aJson = vm.parseJsonUintArray(raw, string.concat(pre, ".a"));
        uint256[][] memory bJson =
            abi.decode(vm.parseJson(raw, string.concat(pre, ".b")), (uint256[][]));
        uint256[] memory cJson = vm.parseJsonUintArray(raw, string.concat(pre, ".c"));
        bytes32 storedLeaf = vm.parseJsonBytes32(raw, string.concat(pre, ".hash"));

        uint256[2] memory a = [aJson[0], aJson[1]];
        uint256[2][2] memory b;
        b[0] = [bJson[0][0], bJson[0][1]];
        b[1] = [bJson[1][0], bJson[1][1]];
        uint256[2] memory c = [cJson[0], cJson[1]];

        assertEq(
            keccak256(abi.encode(id, vkHash, pi, a, b, c)),
            storedLeaf,
            "live CLI decimal proof leaf must equal on-chain registry anchor"
        );
        assertEq(
            storedLeaf,
            0xa806982c7101c24316a7cc43008fe0f0e72740773d6cb0396da523b4ca54e7e5,
            "deviation from the captured anvil leaf"
        );
    }
}
