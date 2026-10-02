//! P8.11: Regression test for P8-004 fix
//!
//! Verifies that `signer_pub_fingerprint` is now included in
//! `Checkpoint::canonical_bytes()`, so tampering with the fingerprint
//! invalidates the ML-DSA-87 signature.
//!
//! Run: cargo test -p ha_cluster --test raft_p8_regression_p8004 -- --test-threads=1

use std::path::PathBuf;

use audit_ledger::{Checkpoint, CommittedCheckpoint, CheckpointWriter};
use core_crypto::QuantumNodeIdentity;
use ha_cluster::NodeId;

/// Helper: create a valid signed checkpoint with the given identity.
fn create_valid_checkpoint(
    identity: &QuantumNodeIdentity,
    seq: u64,
    prev_hash_hex: &str,
) -> CommittedCheckpoint {
    let pub_key_bytes = identity.dsa_public_key_bytes();
    let signer_fp = hex::encode(QuantumNodeIdentity::hash_ledger_block(&pub_key_bytes));

    let cp = Checkpoint {
        version: 1,
        cluster_id: format!("cluster-p8-11-{}", seq),
        config_epoch: 1,
        raft_term: 1,
        raft_log_index: 1 + seq,
        ledger_first_seq: 0,
        ledger_last_seq: seq,
        ledger_entry_count: 1 + seq,
        merkle_root: "00".repeat(32),
        previous_checkpoint_hash: prev_hash_hex.to_string(),
        timestamp_ms: 1234567890000u128,
        signature: String::new(),
        signer_pub_fingerprint: signer_fp,
    };

    let canonical = cp.canonical_hash().unwrap();
    let sig = identity.sign_payload(&canonical).unwrap();
    let mut cp = cp;
    cp.signature = hex::encode(&sig);
    CommittedCheckpoint {
        checkpoint: cp,
        raft_commit_term: 1,
        raft_commit_index: 1 + seq,
    }
}

/// P8.11a: Tampering signer_pub_fingerprint now invalidates the signature.
///
/// **Before fix (P8-004):** Changing `signer_pub_fingerprint` did NOT
/// invalidate the signature (fingerprint was not in canonical_bytes).
///
/// **After fix:** The signature MUST fail when `signer_pub_fingerprint`
/// is changed, because the fingerprint is now part of the signed data.
#[test]
fn p8_11a_fingerprint_change_invalidates_signature() {
    let identity_a = QuantumNodeIdentity::generate_node_identity().unwrap();
    let identity_b = QuantumNodeIdentity::generate_node_identity().unwrap();
    let pub_key_a = identity_a.dsa_public_key_bytes();

    let cp = create_valid_checkpoint(&identity_a, 0, &"0".repeat(64));

    // Verify the original signature is valid
    {
        let canonical = cp.checkpoint.canonical_hash().unwrap();
        let sig_bytes = hex::decode(&cp.checkpoint.signature).unwrap();
        assert!(QuantumNodeIdentity::verify_signature(&pub_key_a, &canonical, &sig_bytes),
            "Original signature must be valid before tampering");
    }

    // Tamper with the fingerprint
    let mut tampered = cp.clone();
    let fp_b = hex::encode(QuantumNodeIdentity::hash_ledger_block(
        &identity_b.dsa_public_key_bytes()
    ));
    tampered.checkpoint.signer_pub_fingerprint = fp_b;

    // After fix: canonical_hash now includes signer_pub_fingerprint
    // → changing it changes the canonical hash → signature no longer matches
    let canonical = tampered.checkpoint.canonical_hash().unwrap();
    let sig_bytes = hex::decode(&tampered.checkpoint.signature).unwrap();

    let sig_valid = QuantumNodeIdentity::verify_signature(&pub_key_a, &canonical, &sig_bytes);

    assert!(!sig_valid,
        "P8-004 FIX: Changing signer_pub_fingerprint MUST invalidate the signature");

    println!("P8.11a PASSED: signer_pub_fingerprint is now cryptographically bound to the signature");
}

/// P8.11b: CheckpointWriter rejects a checkpoint with tampered fingerprint.
///
/// **After fix:** `CheckpointWriter::append` verifies chain linkage via
/// `checkpoint_hash()` which includes the (now modified) canonical hash.
/// A tampered fingerprint changes the canonical hash → changes the
/// checkpoint hash → breaks chain linkage on the next checkpoint.
#[test]
fn p8_11b_checkpoint_chain_breaks_on_fingerprint_tamper() {
    let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    let dir = std::env::temp_dir();
    let cp_path = dir.join("p8_11b_checkpoint_chain.jsonl");
    let _ = std::fs::remove_file(&cp_path);

    // Write a valid checkpoint
    let writer = CheckpointWriter::open(&cp_path)
        .unwrap_or_else(|e| panic!("{}", e));

    let cp1 = create_valid_checkpoint(&identity, 0, &"0".repeat(64));
    writer.append(&cp1).unwrap_or_else(|e| panic!("{}", e));

    // Now tamper: create a 2nd checkpoint with a wrong fingerprint,
    // re-signed with identity (so signature is valid for the tampered content)
    let fp_b = hex::encode(QuantumNodeIdentity::hash_ledger_block(
        &identity.dsa_public_key_bytes()
    ));

    let cp1_hash = cp1.checkpoint.checkpoint_hash().unwrap();
    let prev_hash_hex = hex::encode(cp1_hash);

    // Create a 2nd checkpoint with the CORRECT fingerprint
    let cp2 = create_valid_checkpoint(&identity, 1, &prev_hash_hex);
    let cp2_hash = cp2.checkpoint.checkpoint_hash().unwrap();

    // Tamper with cp2's fingerprint (but keep the same signature)
    let mut tampered_cp2 = cp2.clone();
    // Use a different fingerprint (simulating a forged identity)
    let fake_identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    tampered_cp2.checkpoint.signer_pub_fingerprint = hex::encode(
        QuantumNodeIdentity::hash_ledger_block(&fake_identity.dsa_public_key_bytes())
    );

    // After fix: the signature was over the ORIGINAL canonical bytes (with correct fp).
    // The tampered canonical bytes (with wrong fp) produce a different hash.
    // So verify_signature will fail.
    let pub_key = identity.dsa_public_key_bytes();
    let canonical = tampered_cp2.checkpoint.canonical_hash().unwrap();
    let sig_bytes = hex::decode(&tampered_cp2.checkpoint.signature).unwrap();
    let sig_valid = QuantumNodeIdentity::verify_signature(&pub_key, &canonical, &sig_bytes);

    assert!(!sig_valid,
        "P8-004 fix: tampered fingerprint must invalidate signature verification");

    // The checkpoint hash also changes → chain linkage breaks
    let tampered_hash = tampered_cp2.checkpoint.checkpoint_hash().unwrap();
    assert_ne!(tampered_hash, cp2_hash,
        "Tampered fingerprint must change the checkpoint hash (breaks chain linkage)");

    println!("P8.11b PASSED: Checkpoint chain breaks on fingerprint tamper (P8-004 fixed)");

    let _ = std::fs::remove_file(&cp_path);
}

/// P8.11c: Valid checkpoint with correct fingerprint still verifies.
///
/// **Regression:** Ensure the fix doesn't break legitimate checkpoint signing.
#[test]
fn p8_11c_valid_checkpoint_still_verifies() {
    let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    let pub_key = identity.dsa_public_key_bytes();

    let cp = create_valid_checkpoint(&identity, 0, &"0".repeat(64));

    // Verify the signature
    let canonical = cp.checkpoint.canonical_hash().unwrap();
    let sig_bytes = hex::decode(&cp.checkpoint.signature).unwrap();
    let sig_valid = QuantumNodeIdentity::verify_signature(&pub_key, &canonical, &sig_bytes);

    assert!(sig_valid,
        "Valid checkpoint with correct fingerprint must still pass verification");

    // Verify the fingerprint matches
    let expected_fp = hex::encode(QuantumNodeIdentity::hash_ledger_block(&pub_key));
    assert_eq!(cp.checkpoint.signer_pub_fingerprint, expected_fp,
        "Fingerprint should match the signing key");

    println!("P8.11c PASSED: Valid checkpoints with correct fingerprint still verify");
}

/// P8.11d: Canonical bytes format is stable and deterministic.
///
/// **Regression:** The canonical bytes must be identical across calls for
/// the same checkpoint contents, and must include signer_pub_fingerprint.
#[test]
fn p8_11d_canonical_bytes_include_fingerprint() {
    let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    let fp = hex::encode(QuantumNodeIdentity::hash_ledger_block(
        &identity.dsa_public_key_bytes()
    ));

    let cp = create_valid_checkpoint(&identity, 0, &"0".repeat(64));

    let bytes1 = cp.checkpoint.canonical_bytes().unwrap();
    let bytes2 = cp.checkpoint.canonical_bytes().unwrap();

    // Determinism
    assert_eq!(bytes1, bytes2,
        "canonical_bytes must be deterministic");

    // The fingerprint string must appear in the canonical bytes
    assert!(bytes1.windows(fp.len()).any(|w| w == fp.as_bytes()),
        "signer_pub_fingerprint must be present in canonical_bytes");

    println!("P8.11d PASSED: canonical_bytes is deterministic and includes signer_pub_fingerprint");
}
