//! Phase 3: Live AWS KMS Custody Binding & Daemon Restart Recovery Test
//!
//! Acceptance scenario:
//! 1. Start daemon simulation / Cold start
//! 2. Generate or load encrypted key envelope via AWS KMS hardware CMK (eu-north-1)
//! 3. Verify zero plaintext key material on disk (pure envelope ciphertext)
//! 4. In-memory restoration of ML-DSA-87 private key (Zeroizing)
//! 5. Perform operational ML-DSA-87 signing on transaction payload
//! 6. Shutdown daemon (drop in-memory keys, zeroize memory)
//! 7. Cold restart daemon: load envelope from disk, call AWS KMS Decrypt, restore keys
//! 8. Repeat operational ML-DSA-87 signing on subsequent transaction payload
//! 9. Negative control: Tampered envelope must fail closed on restart

#![cfg(feature = "aws-kms-real")]

use core_crypto::vault::{AwsSdkKmsClient, EncryptedEnvelope, KmsKeyProtector};
use core_crypto::QuantumNodeIdentity;
use std::fs;
use std::sync::Arc;

fn resolve_aws_kms_config() -> Option<(String, String)> {
    let key_id = std::env::var("KMS_KEY_ID")
        .or_else(|_| std::env::var("P3_5_KMS_KEY_ID"))
        .or_else(|_| std::env::var("VARDHAN_AWS_KMS_KEY_ID"))
        .unwrap_or_else(|_| "86a104c0-0561-4746-883e-960950cf61f9".to_string());

    let region = std::env::var("AWS_REGION")
        .or_else(|_| std::env::var("AWS_DEFAULT_REGION"))
        .unwrap_or_else(|_| "eu-north-1".to_string());

    // Verify AWS credentials exist in environment or ~/.aws/credentials
    if std::env::var("AWS_ACCESS_KEY_ID").is_ok() {
        return Some((key_id, region));
    }

    let home = std::env::var("HOME").ok()?;
    let cred_path = std::path::Path::new(&home).join(".aws").join("credentials");
    if cred_path.exists() {
        return Some((key_id, region));
    }

    None
}

#[test]
fn test_live_aws_kms_daemon_recovery_and_signing_lifecycle() {
    let (key_id, region) = match resolve_aws_kms_config() {
        Some(cfg) => cfg,
        None => {
            eprintln!("SKIP: AWS credentials not found in env or ~/.aws/credentials");
            return;
        }
    };
    std::env::set_var("AWS_REGION", &region);

    println!("\n================================================================================");
    println!("  PHASE 3: LIVE AWS KMS CUSTODY & DAEMON RECOVERY ACCEPTANCE DRILL");
    println!("  Region: {} | Key ID: {}", region, key_id);
    println!("================================================================================");

    let test_id = rand::random::<u64>();
    let vault_path = std::env::temp_dir().join(format!("qcore_node_identity_{test_id}.envelope"));

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 1: Cold Boot — Initial Generation & Hardware Envelope Sealing
    // ─────────────────────────────────────────────────────────────────────────────
    println!("\n[STEP 1] Initializing Daemon Boot #1 (First Provisioning)...");
    let client1 = Arc::new(
        AwsSdkKmsClient::new(&key_id)
            .expect("FATAL: Failed to initialize AWS KMS client with credentials"),
    );
    let protector1 = KmsKeyProtector::new(key_id.clone(), client1.clone());

    let identity_boot1 = QuantumNodeIdentity::load_or_generate(&vault_path, &protector1)
        .expect("FATAL: Failed to provision QuantumNodeIdentity with live AWS KMS envelope");

    let original_fp = identity_boot1.signer_pub_fingerprint();
    let original_pk_bytes = identity_boot1.dsa_public_key_bytes();
    println!(
        "  [PASS] Node Identity generated. ML-DSA-87 Fingerprint: {}",
        hex::encode(original_fp)
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 2: Verify Disk State (Zero Plaintext Persistence)
    // ─────────────────────────────────────────────────────────────────────────────
    println!("\n[STEP 2] Verifying On-Disk Storage Boundary (Zero Plaintext Leakage)...");
    assert!(vault_path.exists(), "Vault envelope file must exist on disk");
    let raw_envelope_content =
        fs::read_to_string(&vault_path).expect("Failed to read vault envelope file");

    let envelope: EncryptedEnvelope = serde_json::from_str(&raw_envelope_content)
        .expect("Vault envelope must deserialize to valid EncryptedEnvelope");

    assert_eq!(envelope.provider, "aws-kms");
    assert!(
        envelope.wrapped_dek.is_some(),
        "Envelope must contain KMS-wrapped DEK"
    );
    assert!(
        !envelope.wrapped_payload.is_empty(),
        "Envelope must contain wrapped payload"
    );

    // Scan raw envelope text to ensure no raw private key bytes exist
    assert!(
        !raw_envelope_content.contains("dsa_private_key_bytes\": ["),
        "Raw private key field must NEVER be plaintext in vault file"
    );
    println!(
        "  [PASS] Confirmed on-disk envelope: Provider='aws-kms', Wrapped DEK={} bytes, Wrapped Payload={} bytes",
        envelope.wrapped_dek.as_ref().unwrap().len(),
        envelope.wrapped_payload.len()
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 3: Operational Signing in Boot #1
    // ─────────────────────────────────────────────────────────────────────────────
    println!("\n[STEP 3] Executing Operational ML-DSA-87 Financial Settlement Signing (Boot #1)...");
    let tx1_payload = b"{\"tx_id\": \"TX-AWS-KMS-001\", \"amount_minor\": 75000000, \"currency\": \"GBP\", \"rail\": \"CHAPS\"}";
    let sig1 = identity_boot1
        .sign_payload(tx1_payload)
        .expect("Failed to sign transaction payload with ML-DSA-87");

    assert_eq!(
        sig1.len(),
        4627,
        "ML-DSA-87 signature must be exactly 4627 bytes (NIST FIPS 204)"
    );
    let verified1 =
        QuantumNodeIdentity::verify_signature(&original_pk_bytes, tx1_payload, &sig1);
    assert!(verified1, "ML-DSA-87 signature must verify successfully");
    println!(
        "  [PASS] Signature verified against ML-DSA-87 public key ({} bytes)",
        sig1.len()
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 4: Daemon Shutdown Simulation (Drop all in-memory keys)
    // ─────────────────────────────────────────────────────────────────────────────
    println!("\n[STEP 4] Simulating Complete Daemon Process Shutdown (Memory Zeroization)...");
    drop(identity_boot1);
    drop(protector1);
    drop(client1);
    println!("  [PASS] All in-memory identity and client handles dropped. Memory zeroized.");

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 5: Daemon Restart #1 (Cold Restore from AWS KMS)
    // ─────────────────────────────────────────────────────────────────────────────
    println!("\n[STEP 5] Simulating Daemon Restart #1: Cold Start Recovery via AWS KMS Decrypt...");
    let client2 = Arc::new(
        AwsSdkKmsClient::new(&key_id)
            .expect("Failed to re-initialize AWS KMS client on restart"),
    );
    let protector2 = KmsKeyProtector::new(key_id.clone(), client2.clone());

    let identity_boot2 = QuantumNodeIdentity::load_or_generate(&vault_path, &protector2)
        .expect("FATAL: Failed to restore QuantumNodeIdentity from vault via AWS KMS Decrypt");

    let restored_fp2 = identity_boot2.signer_pub_fingerprint();
    let restored_pk2 = identity_boot2.dsa_public_key_bytes();
    assert_eq!(
        restored_fp2, original_fp,
        "Restored key fingerprint must match original key"
    );
    assert_eq!(
        restored_pk2, original_pk_bytes,
        "Restored public key bytes must match original key"
    );
    println!(
        "  [PASS] Identity recovered successfully from AWS KMS! Fingerprint matches: {}",
        hex::encode(restored_fp2)
    );

    // Verify operational signing on second transaction payload
    let tx2_payload = b"{\"tx_id\": \"TX-AWS-KMS-002\", \"amount_minor\": 120000000, \"currency\": \"GBP\", \"rail\": \"RTGS\"}";
    let sig2 = identity_boot2
        .sign_payload(tx2_payload)
        .expect("Failed to sign transaction #2 with restored key");
    let verified2 =
        QuantumNodeIdentity::verify_signature(&restored_pk2, tx2_payload, &sig2);
    assert!(
        verified2,
        "Signature #2 must verify against restored public key"
    );
    println!(
        "  [PASS] Post-restart ML-DSA-87 signature verified successfully ({} bytes)",
        sig2.len()
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 6: Daemon Restart #2 (Repeatability Verification)
    // ─────────────────────────────────────────────────────────────────────────────
    println!("\n[STEP 6] Simulating Daemon Restart #2: Repeatability Verification...");
    drop(identity_boot2);
    drop(protector2);
    drop(client2);

    let client3 = Arc::new(AwsSdkKmsClient::new(&key_id).unwrap());
    let protector3 = KmsKeyProtector::new(key_id.clone(), client3);
    let identity_boot3 = QuantumNodeIdentity::load_or_generate(&vault_path, &protector3)
        .expect("Failed to restore on second restart");

    let tx3_payload = b"{\"tx_id\": \"TX-AWS-KMS-003\", \"amount_minor\": 33000000, \"currency\": \"EUR\", \"rail\": \"TARGET2\"}";
    let sig3 = identity_boot3
        .sign_payload(tx3_payload)
        .expect("Failed to sign transaction #3");
    assert!(QuantumNodeIdentity::verify_signature(
        &original_pk_bytes,
        tx3_payload,
        &sig3
    ));
    println!("  [PASS] Repeatable restart #2 verified. Operational signing intact.");

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 7: Negative Control — Tampered Ciphertext Must Fail Closed
    // ─────────────────────────────────────────────────────────────────────────────
    println!("\n[STEP 7] Negative Security Control: Tampered Ciphertext Fail-Closed Rejection...");
    drop(identity_boot3);

    // Tamper with ciphertext in the vault envelope
    let mut tampered_envelope = envelope.clone();
    let ct_len = tampered_envelope.wrapped_payload.len();
    tampered_envelope.wrapped_payload[ct_len / 2] ^= 0xFF;
    let tampered_json = serde_json::to_string(&tampered_envelope).unwrap();
    fs::write(&vault_path, tampered_json).expect("Failed to write tampered vault");

    let client_tamper = Arc::new(AwsSdkKmsClient::new(&key_id).unwrap());
    let protector_tamper = KmsKeyProtector::new(key_id, client_tamper);
    let tamper_result = QuantumNodeIdentity::load_or_generate(&vault_path, &protector_tamper);

    match tamper_result {
        Ok(_) => panic!("Daemon must strictly refuse to start if envelope ciphertext is tampered"),
        Err(e) => println!("  [PASS] Tampered envelope correctly rejected on daemon boot: {e}"),
    }

    // Clean up temporary vault
    let _ = fs::remove_file(vault_path);

    println!("\n================================================================================");
    println!("  PHASE 3 ACCEPTANCE RESULT: ALL CONTROLS VERIFIED LIVE (7/7 PASS)");
    println!("================================================================================\n");
}
