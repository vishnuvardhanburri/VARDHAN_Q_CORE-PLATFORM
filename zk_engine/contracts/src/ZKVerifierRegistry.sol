// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IZkVerifier} from "./interfaces/IZkVerifier.sol";
import {IZKVerifierRegistry} from "./interfaces/IZKVerifierRegistry.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {
    PausableUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title ZKVerifierRegistry — append-only on-chain ledger of Groth16 proofs
/// @notice ADR-0004 / ADR-0010: proof anchors for the ZK proof engine.
///         Appends `keccak256(circuitId, vkHash, publicInputs, proof)` leaves
///         after on-chain Groth16 verification against the owner-registered
///         verifier for `circuitId`.
///
/// @dev Upgrade & versioning strategy (ADR-0010):
///      - UUPS proxy: implementation upgrades are authorized by the owner
///        (`_authorizeUpgrade`). The proxy address is immutable from the
///        consumers' perspective (GatedApp, API read client, CI).
///      - Per-circuit verifier upgrades need no registry upgrade: deploy the
///        new verifier + adapter and call `registerCircuit` again.
///      - `SCHEMA_VERSION` tracks the on-chain data layout. An upgrade may
///        keep the schema (patch release) or bump it by exactly 1 (migration
///        release); downgrades and bigger jumps are rejected. Entries are
///        append-only and never rewritten, so data migrations may only add
///        new fields with defaults.
///      - Emergency pause: the owner can halt proof registration
///        (`pause()`); existing statuses remain readable and gatekeeper
///        checks keep working. Deactivation of a circuit is a
///        complementary, permanent mitigation (`deactivateCircuit`).
///
/// Design rules (T5 mitigation):
///  - No external calls during `registerProof` beyond the pairing precompile.
///  - Append-only: no delete, no update of past entries; statuses only
///    transition forward (None -> Proved). Duplicate submissions are
///    idempotent, never re-emit, and never change `provedAt`.
///  - `vkHash` must match the owner-registered value, binding the off-chain
///    canonical-vk hash (ADR-0008) to the on-chain verifier.
contract ZKVerifierRegistry is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IZKVerifierRegistry
{
    /// @notice Schema version of the persisted registry layout. Bumped on
    ///         layout changes per ADR-0010 (see contract-level docs).
    uint256 public constant SCHEMA_VERSION = 1;

    /// @notice Status model. Forward-only transitions (ADR-0004):
    ///         None -> Proved -> Revoked. Revocation is permanent; a revoked
    ///         proof can never be re-registered or pass `requireProved`.
    enum ProofStatus {
        None,
        Proved,
        Revoked
    }

    /// @notice Per-proof-anchor record keyed by (circuitId, publicInputHash).
    struct ProofEntry {
        ProofStatus status;
        uint256 provedAt;
    }

    /// @notice Admin-registered circuit configuration.
    struct CircuitConfig {
        address verifier;
        bytes32 vkHash;
        bool active;
    }

    mapping(bytes32 circuitId => CircuitConfig) public circuits;
    /// @notice Append-only leaf set: proofHash -> registered.
    mapping(bytes32 leafHash => bool) public proofLeaves;
    /// @notice Keyed lookup: (circuitId, publicInputHash) -> status.
    mapping(bytes32 circuitId => mapping(bytes32 publicInputHash => ProofEntry)) public proofStatus;
    /// @notice Total distinct proofs registered (never decreases).
    uint256 public totalProofs;

    event CircuitRegistered(bytes32 indexed circuitId, address indexed verifier, bytes32 vkHash);
    event CircuitDeactivated(bytes32 indexed circuitId);
    event ProofRegistered(
        bytes32 indexed circuitId,
        bytes32 indexed proofHash,
        address indexed prover,
        uint256 timestamp
    );
    event ProofRevoked(bytes32 indexed circuitId, bytes32 indexed publicInputHash);

    error UnknownCircuit(bytes32 circuitId);
    error CircuitInactive(bytes32 circuitId);
    error VkHashMismatch(bytes32 circuitId, bytes32 expected, bytes32 got);
    error InvalidProof(bytes32 circuitId);
    error NotProved(bytes32 circuitId, bytes32 publicInputHash);
    error ProofExpired(
        bytes32 circuitId, bytes32 publicInputHash, uint256 provedAt, uint256 maxAge
    );
    error ProofIsRevoked(bytes32 circuitId, bytes32 publicInputHash);
    error UnsupportedSchemaUpgrade(uint256 currentSchema, uint256 attemptedSchema);
    error InvalidCircuitRegistration(bytes32 circuitId, address verifier);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializer (replaces the constructor for the UUPS proxy).
    /// @param owner_ Admin address; owns circuit registration, pause and
    ///        upgrades.
    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
        __Pausable_init();
    }

    /// @notice Owner-registers a circuit's verifier and its canonical vkHash.
    /// @dev Re-registration of an existing circuit is allowed (verifier
    ///      upgrade path, ADR-0010); the previous ledger entries stay.
    function registerCircuit(bytes32 circuitId, address verifier, bytes32 vkHash)
        external
        onlyOwner
    {
        if (verifier == address(0)) {
            revert InvalidCircuitRegistration(circuitId, verifier);
        }
        circuits[circuitId] = CircuitConfig({verifier: verifier, vkHash: vkHash, active: true});
        emit CircuitRegistered(circuitId, verifier, vkHash);
    }

    /// @notice Owner permanently deactivates a circuit. Past entries stay
    ///         valid (forward-only statuses, append-only ledger).
    /// @dev Not pause-gated: this is itself the emergency mitigation.
    function deactivateCircuit(bytes32 circuitId) external onlyOwner {
        if (circuits[circuitId].verifier == address(0)) revert UnknownCircuit(circuitId);
        circuits[circuitId].active = false;
        emit CircuitDeactivated(circuitId);
    }

    /// @notice Pauses proof registration (emergency halt). Existing
    ///         statuses remain valid; unpause restores registration.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes proof registration after an emergency halt.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Verify a Groth16 proof on-chain and append its anchor.
    /// @dev Reverts on any tampering; idempotent for exact replays.
    ///      Pause-gated: no new anchors while paused.
    function registerProof(
        bytes32 circuitId,
        bytes32 vkHash,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata publicInputs
    ) external whenNotPaused {
        CircuitConfig memory cfg = circuits[circuitId];
        if (cfg.verifier == address(0)) revert UnknownCircuit(circuitId);
        if (!cfg.active) revert CircuitInactive(circuitId);
        if (cfg.vkHash != vkHash) revert VkHashMismatch(circuitId, cfg.vkHash, vkHash);

        if (!IZkVerifier(cfg.verifier).verifyProof(a, b, c, publicInputs)) {
            revert InvalidProof(circuitId);
        }

        bytes32 publicInputHash = keccak256(abi.encode(publicInputs));
        bytes32 proofHash = keccak256(abi.encode(circuitId, vkHash, publicInputs, a, b, c));

        ProofEntry storage entry = proofStatus[circuitId][publicInputHash];
        if (entry.status == ProofStatus.Revoked) {
            revert ProofIsRevoked(circuitId, publicInputHash);
        }
        if (entry.status != ProofStatus.Proved) {
            entry.status = ProofStatus.Proved;
            entry.provedAt = block.timestamp;
            proofLeaves[proofHash] = true;
            totalProofs += 1;
        }

        emit ProofRegistered(circuitId, proofHash, msg.sender, block.timestamp);
    }

    /// @notice Keyed lookup (ADR-0004). Returns the entry, not just the enum,
    ///         so consumers can enforce their own expiry policy.
    /// @return status Current status of the anchor.
    /// @return provedAt Block timestamp of the (first) registration.
    function getProofStatus(bytes32 circuitId, bytes32 publicInputHash)
        external
        view
        returns (ProofStatus status, uint256 provedAt)
    {
        ProofEntry memory entry = proofStatus[circuitId][publicInputHash];
        return (entry.status, entry.provedAt);
    }

    /// @notice Gatekeeper hook: reverts unless proved and unexpired.
    /// @dev maxAge == 0 means no expiry. Read-only: works while paused.
    ///      Revoked proofs always revert (`ProofIsRevoked`).
    function requireProved(bytes32 circuitId, bytes32 publicInputHash, uint256 maxAge)
        external
        view
    {
        ProofEntry memory entry = proofStatus[circuitId][publicInputHash];
        if (entry.status != ProofStatus.Proved) {
            if (entry.status == ProofStatus.Revoked) {
                revert ProofIsRevoked(circuitId, publicInputHash);
            }
            revert NotProved(circuitId, publicInputHash);
        }
        if (maxAge != 0 && block.timestamp > entry.provedAt + maxAge) {
            revert ProofExpired(circuitId, publicInputHash, entry.provedAt, maxAge);
        }
    }

    /// @notice Owner permanently revokes a proof anchor. Forward-only: a
    ///         revoked proof cannot be re-registered and never passes the
    ///         gatekeeper hook again.
    function revokeProof(bytes32 circuitId, bytes32 publicInputHash) external onlyOwner {
        ProofEntry storage entry = proofStatus[circuitId][publicInputHash];
        if (entry.status != ProofStatus.Proved) revert NotProved(circuitId, publicInputHash);
        entry.status = ProofStatus.Revoked;
        emit ProofRevoked(circuitId, publicInputHash);
    }

    /// @notice Reports the registry schema version (ADR-0010).
    function getSchemaVersion() external pure virtual returns (uint256) {
        return SCHEMA_VERSION;
    }

    /// @dev UUPS upgrade authorization (owner only) + schema guard:
    ///      the new implementation must expose a schema version equal to the
    ///      current one (patch/bugfix) or exactly +1 (migration); downgrades
    ///      and arbitrary contracts are rejected.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        uint256 v = 0;
        try IZKVerifierRegistry(newImplementation).getSchemaVersion() returns (uint256 version) {
            v = version;
        } catch {
            revert UnsupportedSchemaUpgrade(SCHEMA_VERSION, 0);
        }
        if (v < SCHEMA_VERSION || v > SCHEMA_VERSION + 1) {
            revert UnsupportedSchemaUpgrade(SCHEMA_VERSION, v);
        }
    }
}
