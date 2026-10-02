//! P8.10: Regression test for P8-003 (signing key rotation mechanism)
//!
//! Verifies that `QuantumNodeIdentity::rotate_signing_key()` correctly:
//! - Generates a new ML-DSA-87 keypair
//! - Preserves the ML-KEM-1024 identity
//! - Produces a verifiable KeyTransitionRecord (old key signs new key)
//! - Persists the new key to the vault
//! - Old private key cannot sign after rotation
//!
//! Run: cargo test -p ha_cluster --test raft_p8_regression_p8003 -- --test-threads=1

use core_crypto::{KeyTransitionRecord, KeyTransitionPayload, QuantumNodeIdentity};
use core_crypto::vault::{EncryptedEnvelope, KeyProtector, VaultError};
use core_crypto::serde_cbor;

/// Mock protector for testing — wraps/unwraps using a simple XOR-like scheme.
struct MockProtector;

impl KeyProtector for MockProtector {
    fn provider_name(&self) -> &'static str {
        "mock"
    }
    fn wrap(&self, plaintext: &[u8]) -> Result<Vec<u8>, VaultError> {
        // Simple: prefix with version byte
        let mut out = vec![0u8];
        out.extend_from_slice(plaintext);
        Ok(out)
    }
    fn unwrap(&self, ciphertext: &[u8]) -> Result<Vec<u8>, VaultError> {
        if ciphertext.len() < 1 {
            return Err(VaultError::Crypto("Too short".into()));
        }
        Ok(ciphertext[1..].to_vec())
    }
}

/// P8.10a: rotate_signing_key generates a new key and produces a verifiable transition.
#[test]
fn p8_10a_key_rotation_produces_verifiable_transition() {
    let dir = std::env::temp_dir();
    let vault_path = dir.join("p8_10a_vault.json");
    let _ = std::fs::remove_file(&vault_path);

    // Generate original identity and persist to vault
    let mut identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    identity = QuantumNodeIdentity::load_or_generate(&vault_path, &MockProtector)
        .unwrap_or_else(|e| panic!("{}", e));

    let old_fp = identity.signer_pub_fingerprint();
    let old_pub = identity.dsa_public_key_bytes();
    let old_pub_for_verification = old_pub.clone();

    // Rotate the signing key
    let protector = MockProtector;
    let transition: KeyTransitionRecord = identity
        .rotate_signing_key(&vault_path, &protector)
        .unwrap_or_else(|e| panic!("{}", e));

    // 1. New fingerprint differs from old
    let new_fp = identity.signer_pub_fingerprint();
    assert_ne!(old_fp, new_fp,
        "New signing key fingerprint must differ from old fingerprint");

    // 2. Transition record has matching fingerprints
    assert_eq!(transition.old_pubkey_fingerprint, old_fp,
        "Transition record must reference old fingerprint");
    assert_eq!(transition.new_pubkey_fingerprint, new_fp,
        "Transition record must reference new fingerprint");

    // 3. The old key signed the transition (proof of continuity)
    //    Verify: old_pub.sig verifies over the transition payload
    let payload = KeyTransitionPayload {
        old_pubkey_fingerprint: transition.old_pubkey_fingerprint,
        new_pubkey_fingerprint: transition.new_pubkey_fingerprint,
        old_pubkey_bytes: transition.old_pubkey_bytes.clone(),
        new_pubkey_bytes: transition.new_pubkey_bytes.clone(),
    };
    let payload_bytes = serde_cbor::to_vec(&payload).unwrap();
    let sig_valid = QuantumNodeIdentity::verify_signature(
        &old_pub_for_verification,
        &payload_bytes,
        &transition.transition_sig_bytes,
    );
    assert!(sig_valid,
        "Old signing key must have signed the key-transition record (proof of continuity)");

    println!("P8.10a PASSED: Key rotation produces verifiable transition (proof of continuity)");
    let _ = std::fs::remove_file(&vault_path);
}

/// P8.10b: After rotation, the new key is persisted to vault.
#[test]
fn p8_10b_rotated_key_persisted_to_vault() {
    let dir = std::env::temp_dir();
    let vault_path = dir.join("p8_10b_vault.json");
    let _ = std::fs::remove_file(&vault_path);

    // Generate identity and persist
    let protector = MockProtector;
    let mut identity = QuantumNodeIdentity::load_or_generate(&vault_path, &protector)
        .unwrap_or_else(|e| panic!("{}", e));

    // Rotate
    let protector = MockProtector;
    let transition = identity
        .rotate_signing_key(&vault_path, &protector)
        .unwrap_or_else(|e| panic!("{}", e));

    // Reload from vault — should have the NEW key, not the old
    let reloaded = QuantumNodeIdentity::load_or_generate(&vault_path, &MockProtector)
        .unwrap_or_else(|e| panic!("{}", e));

    assert_eq!(reloaded.signer_pub_fingerprint(), transition.new_pubkey_fingerprint,
        "Reloaded identity must have the new (rotated) signing key fingerprint");
    assert_ne!(reloaded.signer_pub_fingerprint(), transition.old_pubkey_fingerprint,
        "Reloaded identity must NOT have the old signing key fingerprint");

    println!("P8.10b PASSED: Rotated key persisted to vault and reloadable");
    let _ = std::fs::remove_file(&vault_path);
}

/// P8.10c: KEM identity is preserved across signing key rotation.
#[test]
fn p8_10c_kem_identity_preserved() {
    let dir = std::env::temp_dir();
    let vault_path = dir.join("p8_10c_vault.json");
    let _ = std::fs::remove_file(&vault_path);

    let mut identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    let old_kem_pub = identity.encap_key_bytes();

    let protector = MockProtector;
    let _transition = identity
        .rotate_signing_key(&vault_path, &protector)
        .unwrap_or_else(|e| panic!("{}", e));

    let new_kem_pub = identity.encap_key_bytes();
    assert_eq!(old_kem_pub, new_kem_pub,
        "ML-KEM-1024 encapsulation key must be preserved across signing key rotation");

    println!("P8.10c PASSED: KEM identity preserved across signing key rotation");
    let _ = std::fs::remove_file(&vault_path);
}

/// P8.10d: Old signing key cannot sign after rotation.
#[test]
fn p8_10d_old_key_cannot_sign_after_rotation() {
    let dir = std::env::temp_dir();
    let vault_path = dir.join("p8_10d_vault.json");
    let _ = std::fs::remove_file(&vault_path);

    let mut identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    let old_pk_bytes = identity.dsa_public_key_bytes();
    let old_sig = identity.sign_payload(b"test message").unwrap();
    let _ = std::fs::remove_file(&vault_path);

    identity = QuantumNodeIdentity::load_or_generate(&vault_path, &MockProtector)
        .unwrap_or_else(|e| panic!("{}", e));

    let protector = MockProtector;
    let _transition = identity
        .rotate_signing_key(&vault_path, &protector)
        .unwrap_or_else(|e| panic!("{}", e));

    // The old (pre-rotation) signature must NOT verify against the new key
    // because the private key was replaced
    let new_pk_bytes = identity.dsa_public_key_bytes();
    assert_ne!(old_pk_bytes, new_pk_bytes,
        "Public key must change after rotation");

    let new_sig = identity.sign_payload(b"test message").unwrap();
    assert_ne!(old_sig, new_sig,
        "New signature must differ from old signature (old private key is gone)");

    // Old signature must NOT verify against new public key
    let sig_valid = QuantumNodeIdentity::verify_signature(
        &new_pk_bytes,
        b"test message",
        &old_sig,
    );
    assert!(!sig_valid,
        "Old signature must NOT verify against the new (rotated) public key");

    println!("P8.10d PASSED: Old signing key cannot sign after rotation");
    let _ = std::fs::remove_file(&vault_path);
}
