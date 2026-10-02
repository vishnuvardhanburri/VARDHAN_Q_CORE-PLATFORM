// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";

/// @dev Prints Solidity's ground-truth ABI encodings + anchors for the
///      canonical public-input vectors. Output is captured at development
///      time and frozen in `CanonicalHash.t.sol` and
///      `packages/proof-format/test/abi.test.ts`.
///
///      Run: forge test --match-contract CanonicalVectorsGen -vvvv
contract CanonicalVectorsGen is Test {
    function testPrintGroundTruth() public pure {
        uint256[] memory empty = new uint256[](0);
        uint256[] memory zero = new uint256[](1);
        zero[0] = 0;
        uint256[] memory one = new uint256[](1);
        one[0] = 1;
        uint256[] memory small = new uint256[](1);
        small[0] = 31337;
        uint256[] memory pair = new uint256[](2);
        pair[0] = 31337;
        pair[1] = 1234567;

        uint256[][] memory all = new uint256[][](5);
        all[0] = empty;
        all[1] = zero;
        all[2] = one;
        all[3] = small;
        all[4] = pair;

        string[5] memory labels = ["v-empty", "v-zero", "v-one", "v-small", "v-pair"];
        for (uint256 i = 0; i < all.length; i++) {
            bytes memory enc = abi.encode(all[i]);
            bytes32 anchor = keccak256(enc);
            console2.log("VECTOR", labels[i]);
            console2.logBytes(enc);
            console2.logBytes32(anchor);
        }
    }
}
