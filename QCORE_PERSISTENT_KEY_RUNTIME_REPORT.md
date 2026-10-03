# Q-Core Persistent Keystore Runtime Report

## IMPLEMENTED
1. **Persistent Keystore Load/Save**: Upgraded the `VardhanKeystore` in the `vardhan_keystore` crate to natively support serializing and deserializing key material (Ed25519 & ML-DSA-87) to/from a stable directory on disk via `save_to_dir()` and `load_from_dir()`.
2. **Gateway Keystore Initialization**: Created `keystore_manager.rs` to load the persistent signing identity at Gateway startup (via `VARDHAN_KEYSTORE_DIR`). If a valid identity cannot be loaded, it will generate a new persistent Q-Core signer on first-run.
3. **Transaction Signing Refactor**: Replaced ephemeral request-scoped key generation (`mldsa_keypair()` and `SigningKey::generate()`) in `process_transaction` with calls to `keystore_manager::get_keystore().sign_*()`, ensuring all governed receipts from a running node share the same cryptographic issuer identity.
4. **Stable Key Identity Mapping**: The receipt `DualSignature` now uses the persistent `key_identity.key_id` directly rather than generating random UUIDs.
5. **Atomic Hardened Persistence**: Keystore serialization enforces `0600` restrictive filesystem permissions (Unix) and utilizes atomic persistence (`fs::rename` from a `.tmp` file).
6. **Integrity Consistency Checks**: `load_from_dir` mandates a strict mathematical verification step checking metadata against the re-computed public-key fingerprint and explicitly testing `mldsa_verify()` via a dummy signature to confirm mathematically sound pairs.
7. **Strict Fail-Closed Fallback**: Refactored `keystore_manager` so that if any filesystem data exists, but the keystore cannot be loaded or is corrupted, it explicitly panics and refuses to start up or fallback to ephemeral keys.

## VERIFIED BY TEST
* **End-to-End Persistence** (`test_gateway_persistent_keystore_end_to_end`):
  * **Test 1**: Verifies the keystore generates and stores stable `ed25519` and `mldsa87` key identities.
  * **Test 2**: Simulates a full `process_transaction` request and asserts that the returned `VardhanSealedReceipt` correctly carries the expected stable `ed25519_key_id`.
  * **Test 3**: Runs the *independent verifier* (`VardhanVerifier`) on the generated receipt, passing in the keystore's public key bytes, confirming the hybrid signatures are cryptographically valid.
  * **Test 4**: Reloads the keystore from the disk directory (simulating process restart) and asserts that the exact same key ID and public key bytes are successfully restored.
* **Corrupted State** (`test_persistence_rejects_corrupted_metadata`):
  * Unit test verifies that a corrupted fingerprint triggers an explicit error during `load_from_dir()`.

## OBSERVED LIMITATION
* **Basic File System Storage**: `vardhan_keystore` uses local filesystem directories to store private keys (`.key`, `.sec` files). This is **PERSISTENT BUT NOT ENCRYPTED-AT-REST / NOT HSM-KMS BACKED**. For a true HA cluster, this either requires a shared block device, KMS integration, or Raft consensus on key generation metadata, none of which are implemented in this change.
* **Single Tenant Key Architecture**: The current implementation operates with a single unified Q-Core signing key across all tenants rather than tenant-specific key isolation (though the tenant ID is securely embedded in the receipt payload itself).
* **Missing Key Rotation**: There is currently no active support for automatic rotation of the persistent keystore key material, relying on a static generation event on first-run or catastrophic replacement.

## NOT YET IMPLEMENTED
* **KMS/HSM Backend Integration**: External Key Management System support (AWS KMS, Azure Key Vault, etc.) is not wired into `VardhanKeystore`. The persistence is strictly local disk.
* **Distributed Key Provisioning**: When running multiple Q-Core gateway nodes, they currently each generate their own persistent identity on startup if they don't share the same `VARDHAN_KEYSTORE_DIR`. A mechanism to securely distribute the primary signing key from a leader node to replica nodes is not implemented.
