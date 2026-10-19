// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ZKVerifierRegistry} from "./ZKVerifierRegistry.sol";

/// @title ProofGatekeeper — consumable hook for downstream contracts
/// @notice ADR-0004: any derived contract can gate a call on a valid,
///         unexpired registry entry. On-chain extension of the CI/CD
///         gatekeeper model (roadmap M8).
/// @dev Usage: `contract MyApp is ProofGatekeeper { ... }` then tag restricted
///      functions with `onlyProved(circuitId, publicInputHash)`.
///      The registry address and `proofMaxAge` are immutable: point the
///      upstream at the registry *proxy* so upgrades never break consumers.
abstract contract ProofGatekeeper {
    /// @notice Registry whose `requireProved` backs this hook.
    ZKVerifierRegistry public immutable registry;

    /// @notice Maximum age of an anchor in seconds; 0 = never expires.
    uint256 public immutable proofMaxAge;

    error OnlyProved(bytes32 circuitId, bytes32 publicInputHash);

    /// @param registry_ The ZKVerifierRegistry proxy address.
    /// @param proofMaxAge_ Maximum anchor age before it expires (0 = none).
    constructor(address registry_, uint256 proofMaxAge_) {
        registry = ZKVerifierRegistry(registry_);
        proofMaxAge = proofMaxAge_;
    }

    /// @notice Standardized gate: reverts (OnlyProved) when the anchor is
    ///         missing or expired, so downstream logic can rely on the
    ///         status without re-parsing registry errors.
    /// @param circuitId Circuit whose anchor is required.
    /// @param publicInputHash keccak256 of the proof's public inputs.
    modifier onlyProved(bytes32 circuitId, bytes32 publicInputHash) {
        try registry.requireProved(circuitId, publicInputHash, proofMaxAge) {}
        catch {
            revert OnlyProved(circuitId, publicInputHash);
        }
        _;
    }
}
