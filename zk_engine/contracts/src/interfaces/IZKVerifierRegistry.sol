// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @notice Minimal surface a ZKVerifierRegistry implementation must expose
///         for the UUPS schema guard (ADR-0010).
interface IZKVerifierRegistry {
    function getSchemaVersion() external pure returns (uint256);
}
