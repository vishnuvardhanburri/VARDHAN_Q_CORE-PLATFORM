// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ZKVerifierRegistry} from "../src/ZKVerifierRegistry.sol";
import {VerifierPoseidonPreimage} from "../src/VerifierPoseidonPreimage.sol";
import {VerifierPoseidonPreimageAdapter} from "../src/VerifierPoseidonPreimageAdapter.sol";
import {VerifierMerkleInclusion} from "../src/VerifierMerkleInclusion.sol";
import {VerifierMerkleInclusionAdapter} from "../src/VerifierMerkleInclusionAdapter.sol";

/// @notice Shared deployment + fixture helpers for registry tests.
abstract contract RegistryBase is Test {
    string constant FIXTURES = "test/fixtures/proofs.json";

    ZKVerifierRegistry public registry;
    VerifierPoseidonPreimageAdapter poseidonAdapter;
    VerifierMerkleInclusionAdapter merkleAdapter;
    address admin;
    address nonce;
    address prover;

    bytes32 constant POSEIDON_ID = bytes32("poseidon-preimage");
    bytes32 constant MERKLE_ID = bytes32("merkle-inclusion");

    struct ProofFixture {
        bytes32 vkHash;
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
        uint256[] publicInputs;
    }

    /// @dev Deploys the registry behind an ERC-1967 proxy exactly like the
    ///      deploy scripts (ADR-0010).
    function setUp() public virtual {
        admin = makeAddr("admin");
        nonce = makeAddr("nonce");
        prover = makeAddr("prover");

        ZKVerifierRegistry impl = new ZKVerifierRegistry();
        registry = ZKVerifierRegistry(
            address(
                new ERC1967Proxy(
                    address(impl), abi.encodeCall(ZKVerifierRegistry.initialize, (admin))
                )
            )
        );

        vm.startPrank(admin);
        poseidonAdapter =
            new VerifierPoseidonPreimageAdapter(address(new VerifierPoseidonPreimage()));
        merkleAdapter = new VerifierMerkleInclusionAdapter(address(new VerifierMerkleInclusion()));

        registry.registerCircuit(POSEIDON_ID, address(poseidonAdapter), poseidonFixture().vkHash);
        registry.registerCircuit(MERKLE_ID, address(merkleAdapter), merkleFixture().vkHash);
        vm.stopPrank();
    }

    function poseidonFixture() public view returns (ProofFixture memory) {
        return readFixture(0);
    }

    function merkleFixture() public view returns (ProofFixture memory) {
        return readFixture(1);
    }

    function readFixture(uint256 i) internal view returns (ProofFixture memory f) {
        string memory root = vm.readFile(FIXTURES);
        string memory pre = string.concat("$.circuits[", vm.toString(i), "]");
        uint256[2] memory a = [
            vm.parseJsonUint(root, string.concat(pre, ".a[0]")),
            vm.parseJsonUint(root, string.concat(pre, ".a[1]"))
        ];
        uint256[2][2] memory b = [
            [
                vm.parseJsonUint(root, string.concat(pre, ".b[0]")),
                vm.parseJsonUint(root, string.concat(pre, ".b[1]"))
            ],
            [
                vm.parseJsonUint(root, string.concat(pre, ".b[2]")),
                vm.parseJsonUint(root, string.concat(pre, ".b[3]"))
            ]
        ];
        uint256[2] memory c = [
            vm.parseJsonUint(root, string.concat(pre, ".c[0]")),
            vm.parseJsonUint(root, string.concat(pre, ".c[1]"))
        ];

        f.vkHash = vm.parseJsonBytes32(root, string.concat(pre, ".vkHash"));
        f.a = a;
        f.b = b;
        f.c = c;
        f.publicInputs = vm.parseJsonUintArray(root, string.concat(pre, ".publicInputs"));
    }

    function publicInputHash(bytes32 circuitId, uint256[] memory inputs)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(inputs));
    }

    function expectRevertProof(bytes32 circuitId, ProofFixture memory f) internal {
        vm.expectRevert(abi.encodeWithSelector(ZKVerifierRegistry.InvalidProof.selector, circuitId));
        _register(f, circuitId);
    }

    function _register(ProofFixture memory f, bytes32 circuitId) internal {
        registry.registerProof(circuitId, f.vkHash, f.a, f.b, f.c, f.publicInputs);
    }
}
