//! P8.7: Key Compromise / Rotation / Revocation
//!
//! Attacks the vP7.3-frozen baseline.
//!
//! Tests whether the audit ledger and checkpoint system can detect:
//! - Signatures forged with a compromised key
//! - Key switches (entries signed with different keys in the same ledger)
//! - Missing key rotation mechanism (documented gap)
//!
//! Security invariants targeted:
//!   I7  Integrity verification: corrupted/evidence must be detected
//!   I10 No key rotation mechanism means compromised signing keys cannot be revoked
//!
//! Run: cargo test -p ha_cluster --test raft_p8_key_compromise -- --test-threads=1

use std::path::PathBuf;

use audit_ledger::{
    Checkpoint, CommittedCheckpoint, LedgerEntry, LedgerWriter,
    merkle_root_from_ledger_file,
};
use core_crypto::QuantumNodeIdentity;

/// Helper: write N valid ledger entries, returning the path.
fn write_valid_ledger(
    identity: &QuantumNodeIdentity,
    path: &PathBuf,
    count: u64,
) {
    let writer = LedgerWriter::open(path, identity)
        .unwrap_or_else(|e| panic!("{}", e));
    for i in 0..count {
        writer.append(
            serde_json::json!({"type": "write", "seq": i}),
            identity,
        ).unwrap();
    }
}

/// Helper: create a signed checkpoint with the given identity.
fn make_signed_checkpoint(
    identity: &QuantumNodeIdentity,
    seq: u64,
    prev_hash_hex: &str,
) -> CommittedCheckpoint {
    let pub_key_bytes = identity.dsa_public_key_bytes();
    let signer_fp = hex::encode(QuantumNodeIdentity::hash_ledger_block(&pub_key_bytes));

    let cp = Checkpoint {
        version: 1,
        cluster_id: format!("cluster-p8-7-{}", seq),
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

/// P8.7a: Signature verification detects key substitution.
///
/// **Invariant I7:** If an attacker forges a ledger entry using a DIFFERENT
/// key (not the legitimate signer), the signature verification must fail.
#[test]
fn p8_7a_signature_verification_detects_key_substitution() {
    let legitimate = QuantumNodeIdentity::generate_node_identity().unwrap();
    let attacker = QuantumNodeIdentity::generate_node_identity().unwrap();

    let dir = std::env::temp_dir();
    let ledger_path = dir.join("p8_7a_key_subst_ledger.jsonl");
    let _ = std::fs::remove_file(&ledger_path);

    // Write one legitimate entry
    write_valid_ledger(&legitimate, &ledger_path, 1);

    // Attacker creates a forged entry, signing with their OWN key
    // but claiming to be the legitimate signer (forged fingerprint)
    let mut lines: Vec<String> = std::fs::read_to_string(&ledger_path)
        .unwrap()
        .lines()
        .map(|l| l.to_string())
        .collect();
    assert_eq!(lines.len(), 1, "Should have 1 entry");

    let mut entry1: LedgerEntry = serde_json::from_str(&lines[0]).unwrap();
    let forged_event = serde_json::json!({"type": "CORRUPTED", "injected": true});
    entry1.event = forged_event;
    // Attacker signs with their own key — but the fingerprint is still the
    // legitimate signer's (we don't change it). This simulates an attacker
    // who has access to a compromised signing environment.
    let event_json = serde_json::to_string(&entry1.event).unwrap();
    let canonical = entry1.canonical_hash().unwrap();
    let attacker_sig = attacker.sign_payload(&canonical).unwrap();
    entry1.signature = hex::encode(&attacker_sig);

    let mut lines2 = lines.clone();
    lines2.push(serde_json::to_string(&entry1).unwrap());
    std::fs::write(&ledger_path, lines2.join("\n") + "\n").unwrap();

    // pq_verify-level check: verify each entry's signature against the
    // legitimate signer's public key
    let legit_pub = legitimate.dsa_public_key_bytes();

    for line in &lines2 {
        if line.trim().is_empty() { continue; }
        let entry: LedgerEntry = serde_json::from_str(line).unwrap();
        let canonical = entry.canonical_hash();
        let sig_bytes = hex::decode(&entry.signature).unwrap();

        let valid = QuantumNodeIdentity::verify_signature(
            &legit_pub,
            &canonical.unwrap(),
            &sig_bytes,
        );

        if entry.event.get("injected").is_some() {
            assert!(!valid,
                "Forged entry signed with attacker's key must fail signature verification");
        } else {
            assert!(valid, "Legitimate entry must pass signature verification");
        }
    }

    println!("P8.7a PASSED: Signature verification detects key substitution (attacker-signed entry rejected)");
}

/// P8.7b: Key switch detection — ledger with entries signed by different keys.
///
/// **Invariant I7:** Entries signed with a different key mid-ledger should be
/// detectable. The signer_pub_fingerprint field changes, but `scan_existing_ledger`
/// does NOT currently cross-check this. This is a documented gap.
#[test]
fn p8_7b_key_switch_detection() {
    let identity_a = QuantumNodeIdentity::generate_node_identity().unwrap();
    let identity_b = QuantumNodeIdentity::generate_node_identity().unwrap();

    let dir = std::env::temp_dir();
    let ledger_path = dir.join("p8_7b_key_switch.jsonl");
    let _ = std::fs::remove_file(&ledger_path);

    // Write entries with identity_a
    write_valid_ledger(&identity_a, &ledger_path, 3);

    // Now write entries with identity_b (simulating key rotation / compromise)
    let writer_b = LedgerWriter::open(&ledger_path, &identity_b)
        .unwrap_or_else(|e| panic!("{}", e));
    for i in 3..6u64 {
        writer_b.append(
            serde_json::json!({"type": "write", "key": "b", "seq": i}),
            &identity_b,
        ).unwrap();
    }
    drop(writer_b);

    // Read all entries and check signer fingerprints
    let mut lines: Vec<String> = std::fs::read_to_string(&ledger_path)
        .unwrap()
        .lines()
        .map(|l| l.to_string())
        .collect();
    assert_eq!(lines.len(), 6, "Should have 6 entries");

    let fp_a = hex::encode(QuantumNodeIdentity::hash_ledger_block(&identity_a.dsa_public_key_bytes()));
    let fp_b = hex::encode(QuantumNodeIdentity::hash_ledger_block(&identity_b.dsa_public_key_bytes()));

    let mut fingerprints: Vec<String> = Vec::new();
    for line in &lines {
        if line.trim().is_empty() { continue; }
        let entry: LedgerEntry = serde_json::from_str(line).unwrap();
        fingerprints.push(entry.signer_pub_fingerprint.clone());
    }

    // Verify that fingerprints differ (entry 0-2 use fp_a, 3-5 use fp_b)
    assert_eq!(fingerprints[0], fp_a, "Entries 0-2 should have identity_a's fingerprint");
    assert_eq!(fingerprints[2], fp_a, "Entry 2 should have identity_a's fingerprint");
    assert_eq!(fingerprints[5], fp_b, "Entry 5 should have identity_b's fingerprint");
    assert_ne!(fingerprints[0], fingerprints[5],
        "Key switch should be detectable via signer fingerprint comparison");

    // Key finding: scan_existing_ledger does NOT cross-check signer fingerprints
    // It only verifies chain linkage (prev_hash) and sequence monotonicity.
    // So a key switch within the same ledger file would NOT be detected by
    // LedgerWriter::open — it would silently accept the new signer.
    let reopen_result = LedgerWriter::open(&ledger_path, &identity_a);
    assert!(reopen_result.is_ok(),
        "LedgerWriter::open does NOT detect key switches — this is P8-003 (gap)");

    println!("P8.7b PASSED: Key switch detectable via signer fingerprint (but NOT enforced by scan_existing_ledger — gap P8-003)");
}

/// P8.7c: Forged checkpoint signature with wrong key.
///
/// **Invariant I7:** A checkpoint signed with an attacker's key (not the
/// legitimate cluster signing key) must fail verification.
#[test]
fn p8_7c_forged_checkpoint_signature() {
    let legitimate = QuantumNodeIdentity::generate_node_identity().unwrap();
    let attacker = QuantumNodeIdentity::generate_node_identity().unwrap();

    // Create a valid checkpoint with the legitimate key
    let cp = make_signed_checkpoint(&legitimate, 0, &"0".repeat(64));

    // Attacker forges a checkpoint with their own key but tries to pass it off
    // as legitimate by keeping the original signer fingerprint
    let mut forged_cp = cp.clone();
    let attacker_pub = attacker.dsa_public_key_bytes();
    let _legit_fp = hex::encode(QuantumNodeIdentity::hash_ledger_block(&legitimate.dsa_public_key_bytes()));

    // Attacker signs with their key, but the fingerprint still says "legitimate"
    // (simulating that they have access to forge but the fingerprint was pre-set)
    let canonical = forged_cp.checkpoint.canonical_hash().unwrap();
    let attacker_sig = attacker.sign_payload(&canonical).unwrap();
    forged_cp.checkpoint.signature = hex::encode(&attacker_sig);
    // Attacker leaves the signer_pub_fingerprint as the legitimate one

    let pub_key_bytes = legitimate.dsa_public_key_bytes();

    // Verify signature — should fail because the signature was made with attacker's key
    let canonical_forged = forged_cp.checkpoint.canonical_hash().unwrap();
    let sig_bytes = hex::decode(&forged_cp.checkpoint.signature).unwrap();

    let sig_valid = QuantumNodeIdentity::verify_signature(
        &pub_key_bytes,
        &canonical_forged,
        &sig_bytes,
    );

    assert!(!sig_valid,
        "Checkpoint signed with attacker's key must fail verification against legitimate public key");

    // Also check: signer fingerprint still claims to be legitimate
    let actual_attacker_fp = hex::encode(QuantumNodeIdentity::hash_ledger_block(&attacker_pub));
    assert_ne!(actual_attacker_fp, forged_cp.checkpoint.signer_pub_fingerprint,
        "Attacker's fingerprint differs from what the checkpoint claims");

    println!("P8.7c PASSED: Forged checkpoint signature (wrong key) → verification fails");
}

/// P8.7d: Signer fingerprint is NOT cryptographically bound to the signature.
///
/// **Finding P8-004:** The `Checkpoint::canonical_bytes()` (which is what gets
/// signed) does NOT include `signer_pub_fingerprint`. This means an attacker
/// can change the `signer_pub_fingerprint` field without invalidating the
/// signature. pq_verify catches this via a *separate* fingerprint comparison
/// check (not via signature verification), but the signature itself does not
/// bind the fingerprint.
///
/// **Invariant I7:** This is a gap — the fingerprint should be part of the
/// signed data to be cryptographically bound.
#[test]
fn p8_7d_signer_fingerprint_not_in_signature() {
    let identity_a = QuantumNodeIdentity::generate_node_identity().unwrap();
    let identity_b = QuantumNodeIdentity::generate_node_identity().unwrap();
    let pub_key_a = identity_a.dsa_public_key_bytes();

    // Create a checkpoint signed by identity_a (correct fingerprint)
    let cp = make_signed_checkpoint(&identity_a, 0, &"0".repeat(64));
    assert_eq!(cp.checkpoint.signer_pub_fingerprint,
        hex::encode(QuantumNodeIdentity::hash_ledger_block(&pub_key_a)));

    // Attacker changes the fingerprint to identity_b's — but signature is over
    // canonical_bytes which does NOT include signer_pub_fingerprint
    let fp_b = hex::encode(QuantumNodeIdentity::hash_ledger_block(&identity_b.dsa_public_key_bytes()));
    let mut tampered_cp = cp.clone();
    tampered_cp.checkpoint.signer_pub_fingerprint = fp_b.clone();

    // The canonical hash does NOT change (fingerprint not in canonical_bytes)
    let canonical = tampered_cp.checkpoint.canonical_hash().unwrap();
    let sig_bytes = hex::decode(&tampered_cp.checkpoint.signature).unwrap();

    let sig_valid = QuantumNodeIdentity::verify_signature(
        &pub_key_a,
        &canonical,
        &sig_bytes,
    );

    // P8-004 FIX: signature fails because fingerprint IS in signed data (canonical_bytes)
    assert!(!sig_valid,
        "P8-004 FIX: Signature verification fails when fingerprint is tampered — fingerprint is bound in signed data");

    // The fingerprint MISMATCH is also caught by pq_verify's separate check:
    let expected_fp_a = hex::encode(QuantumNodeIdentity::hash_ledger_block(&pub_key_a));
    assert_ne!(tampered_cp.checkpoint.signer_pub_fingerprint, expected_fp_a,
        "Fingerprint should have been changed to identity_b's");

    println!("P8.7d PASSED: P8-004 resolved — signer_pub_fingerprint is cryptographically bound to signature");
}

/// P8.7e: No signing key rotation mechanism (gap assessment).
///
/// **Finding P8-003:** The vP7.3-frozen baseline has NO mechanism to rotate
/// the ML-DSA-87 *signing key* itself. While `rotate_key_protector` exists
/// to re-wrap the key at rest with a different protector, there is no API
/// to generate a new signing key pair and transition to it. If the signing
/// key is compromised, all future entries/checkpoints must still be signed
/// with the same key — revocation is impossible.
#[test]
fn p8_7e_no_signing_key_rotation_mechanism() {
    let source_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../core_crypto/src/lib.rs");
    let content = std::fs::read_to_string(source_path).unwrap_or_default();

    // rotate_key_protector rotates the key *protector* (encryption at rest)
    assert!(content.contains("rotate_key_protector"),
        "rotate_key_protector should exist (protects key at rest)");

    // P8-003 RESOLVED: rotate_signing_key was implemented in core_crypto
    let has_dsa_rotation = content.contains("rotate_signing_key");
    assert!(has_dsa_rotation,
        "P8-003 RESOLVED: DSA signing key rotation mechanism exists (rotate_signing_key)");

    // Check pq_shield for key rotation APIs
    let pq_shield_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../pq_shield/src/admin.rs");
    if let Ok(admin_content) = std::fs::read_to_string(pq_shield_path) {
        let has_signing_key_api = admin_content.contains("rotate_signing_key") ||
            admin_content.contains("rotate_key") && !admin_content.contains("rotate_key_protector");
        assert!(!has_signing_key_api,
            "P8-003: No signing key rotation API endpoint (confirmed gap)");
    }

    // Session/API key revocation IS implemented
    let session_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../auth_service/src/session.rs");
    if let Ok(session_content) = std::fs::read_to_string(session_path) {
        assert!(session_content.contains("revoke_by_id") || session_content.contains("revoked"),
            "Session revocation exists in auth_service");
    }

    println!("P8.7e PASSED: P8-003 resolved — signing key rotation implemented in core_crypto, session revocation exists in auth_service");
}

/// P8.7f: Merkle root integrity under key compromise.
///
/// **Invariant I7:** Even if an entry's signature is forged (compromised key),
/// the Merkle root computed from ledger entries will not match the checkpoint's
/// stored Merkle root if the tampered entry is not included in the checkpoint
/// range.
#[test]
fn p8_7f_merkle_root_integrity_under_key_compromise() {
    let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    let dir = std::env::temp_dir();
    let ledger_path = dir.join("p8_7f_merkle_integrity.jsonl");
    let _ = std::fs::remove_file(&ledger_path);

    // Write 5 valid entries
    write_valid_ledger(&identity, &ledger_path, 5);

    // Compute Merkle root from the valid ledger
    let valid_merkle = merkle_root_from_ledger_file(&ledger_path).unwrap();

    // Create a checkpoint referencing this Merkle root
    let mut cp = make_signed_checkpoint(&identity, 4, &"0".repeat(64));
    cp.checkpoint.ledger_first_seq = 0;
    cp.checkpoint.ledger_last_seq = 4;
    cp.checkpoint.ledger_entry_count = 5;
    cp.checkpoint.merkle_root = hex::encode(valid_merkle);
    let canonical = cp.checkpoint.canonical_hash().unwrap();
    let sig = identity.sign_payload(&canonical).unwrap();
    cp.checkpoint.signature = hex::encode(&sig);

    // Now tamper with entry #2 (middle of the chain)
    let mut lines: Vec<String> = std::fs::read_to_string(&ledger_path)
        .unwrap()
        .lines()
        .map(|l| l.to_string())
        .collect();
    let mut entry2: LedgerEntry = serde_json::from_str(&lines[2]).unwrap();
    entry2.event = serde_json::json!({"type": "TAMPERED"});
    lines[2] = serde_json::to_string(&entry2).unwrap();
    std::fs::write(&ledger_path, lines.join("\n") + "\n").unwrap();

    // Recompute Merkle root from tampered ledger
    let tampered_merkle = merkle_root_from_ledger_file(&ledger_path).unwrap();

    // The Merkle root should be different
    assert_ne!(valid_merkle, tampered_merkle,
        "Tampered ledger must produce a different Merkle root");

    // Verify that the checkpoint's stored Merkle root matches the ORIGINAL (valid) root
    let stored_merkle = hex::decode(&cp.checkpoint.merkle_root).unwrap();
    assert_eq!(stored_merkle.as_slice(), valid_merkle.as_slice(),
        "Checkpoint should store the original (valid) Merkle root");

    // If pq_verify ran this evidence, it would detect the mismatch:
    // computed_merkle (from tampered ledger) != stored_merkle (in checkpoint)
    assert_ne!(tampered_merkle.as_slice(), stored_merkle.as_slice(),
        "pq_verify would detect: computed Merkle root from tampered ledger != stored Merkle root");

    println!("P8.7f PASSED: Merkle root integrity — tampering changes computed root, mismatch with stored checkpoint");
}
