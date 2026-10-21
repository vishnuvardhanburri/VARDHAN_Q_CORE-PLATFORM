//! Comprehensive Production KMS/HSM and Cryptographic Key Lifecycle Verification Drill.
//!
//! Verifies:
//! 1. AWS KMS adapter lifecycle (wrap, unwrap, rotation, revocation, IAM denial, outage handling)
//! 2. Google Cloud KMS adapter lifecycle (wrap, unwrap, rotation, revocation, permission denied)
//! 3. HashiCorp Vault Transit adapter lifecycle (wrap, unwrap, rotation, min_decryption_version)
//! 4. PKCS#11 Hardware Security Module boundary (session open, PIN login, PIN lock, wrap, unwrap)
//! 5. Multi-version key rotation preserving historical receipt verification
//! 6. Key revocation prevents future signing and flags compromised historical keys
//! 7. Zero private key material in metadata, historical registries, or audit logs

use std::sync::Arc;
use tempfile::tempdir;
use vardhan_keystore::history::HistoricalKeyRegistry;
use vardhan_keystore::kms::{
    AwsKmsProvider, GcpCloudKmsProvider, KmsKeyProtectionProvider, Pkcs11HardwareMode,
    Pkcs11HsmProvider, Pkcs11SoftHsmEmulator, VaultTransitProvider,
};
use vardhan_keystore::{
    KeyAlgorithm, KeyProtectionProvider, KeyStatus, KmsProvider, VardhanKeystore,
};

#[test]
fn test_aws_kms_provider_lifecycle() {
    let key_id = "arn:aws:kms:us-east-1:123456789012:key/test-quantum-key";
    let (provider, emu) = AwsKmsProvider::new_emulator(key_id.to_string(), "us-east-1".to_string());
    let arc_provider = Arc::new(provider);
    let protector = KmsKeyProtectionProvider::new(arc_provider.clone(), key_id.to_string());

    assert_eq!(protector.provider_name(), "aws-kms");
    assert!(protector.is_production_safe());

    // 1. Wrap and unwrap private key material
    let secret = b"QUANTUM-PRIVATE-SEED-ED25519-AND-MLDSA87";
    let wrapped = protector
        .wrap_private_key(secret)
        .expect("wrap must succeed");
    assert!(!wrapped.is_empty());
    assert!(!wrapped.windows(secret.len()).any(|w| w == secret));

    let unwrapped = protector
        .unwrap_private_key(&wrapped)
        .expect("unwrap must succeed");
    assert_eq!(&*unwrapped, secret);

    // 2. Rotate KMS master key
    let rotated = arc_provider
        .rotate_key(key_id)
        .expect("rotate must succeed");
    assert_eq!(rotated.key_version, "v2");

    // Unwrapping previously wrapped ciphertext continues to succeed under rotated key (AWS KMS model)
    let unwrapped_after_rot = protector
        .unwrap_private_key(&wrapped)
        .expect("unwrap after rotation");
    assert_eq!(&*unwrapped_after_rot, secret);

    // 3. Simulated IAM AccessDenied fails fast
    emu.set_authorized(false);
    let wrap_denied = protector.wrap_private_key(secret);
    assert!(wrap_denied.is_err(), "AccessDenied must fail wrap");
    let unwrap_denied = protector.unwrap_private_key(&wrapped);
    assert!(unwrap_denied.is_err(), "AccessDenied must fail unwrap");
    emu.set_authorized(true);

    // 4. Simulated service outage fails fast
    emu.set_available(false);
    let wrap_outage = protector.wrap_private_key(secret);
    assert!(wrap_outage.is_err(), "Service outage must fail wrap");
    emu.set_available(true);

    // 5. Revocation blocks further usage
    arc_provider
        .revoke_key(key_id, "Key compromised in drills")
        .expect("revoke must succeed");
    let wrap_revoked = protector.wrap_private_key(secret);
    assert!(wrap_revoked.is_err(), "Revoked key must reject wrap");

    // 6. Audit records captured
    let records = arc_provider.audit_records().expect("audit records");
    assert!(records.len() >= 4);
    assert!(
        records
            .iter()
            .any(|r| r.operation == "encrypt_dek" && r.status == "SUCCESS")
    );
    assert!(
        records
            .iter()
            .any(|r| r.operation == "decrypt_dek" && r.status == "SUCCESS")
    );
    assert!(
        records
            .iter()
            .any(|r| r.operation == "rotate_key" && r.status == "SUCCESS")
    );
}

#[test]
fn test_gcp_cloud_kms_provider_lifecycle() {
    let key_name = "projects/test-proj/locations/global/keyRings/qcore/cryptoKeys/cmk-v1";
    let (provider, emu) = GcpCloudKmsProvider::new_emulator(key_name.to_string());
    let arc_provider = Arc::new(provider);
    let protector = KmsKeyProtectionProvider::new(arc_provider.clone(), key_name.to_string());

    assert_eq!(protector.provider_name(), "gcp-kms");
    assert!(protector.is_production_safe());

    let secret = b"GCP-CLOUD-KMS-PROTECTED-PRIVATE-KEY";
    let wrapped = protector
        .wrap_private_key(secret)
        .expect("wrap must succeed");
    assert!(!wrapped.windows(secret.len()).any(|w| w == secret));

    let unwrapped = protector
        .unwrap_private_key(&wrapped)
        .expect("unwrap must succeed");
    assert_eq!(&*unwrapped, secret);

    // Rotate to CryptoKeyVersion 2
    let rotated = arc_provider.rotate_key(key_name).expect("rotation");
    assert_eq!(rotated.key_version, "v2");

    // Decrypting older ciphertext encrypted under version 1 still succeeds
    let unwrapped_v1 = protector
        .unwrap_private_key(&wrapped)
        .expect("older version unwrap");
    assert_eq!(&*unwrapped_v1, secret);

    // IAM permission denied
    emu.set_authorized(false);
    assert!(protector.wrap_private_key(secret).is_err());
    emu.set_authorized(true);

    // Destroy/revoke
    arc_provider
        .revoke_key(key_name, "Scheduled decommission")
        .expect("revoke");
    assert!(
        protector.unwrap_private_key(&wrapped).is_err(),
        "Destroyed key must reject unwrap"
    );
}

#[test]
fn test_vault_transit_provider_lifecycle() {
    let key_name = "vardhan-qcore-transit";
    let (provider, emu) = VaultTransitProvider::new_emulator(key_name.to_string());
    let arc_provider = Arc::new(provider);
    let protector = KmsKeyProtectionProvider::new(arc_provider.clone(), key_name.to_string());

    assert_eq!(protector.provider_name(), "vault-transit");
    assert!(protector.is_production_safe());

    let secret = b"VAULT-TRANSIT-SECRETS-ENGINE-PAYLOAD";
    let wrapped = protector
        .wrap_private_key(secret)
        .expect("wrap must succeed");

    let unwrapped = protector
        .unwrap_private_key(&wrapped)
        .expect("unwrap must succeed");
    assert_eq!(&*unwrapped, secret);

    // Rotate transit key to version 2
    let rotated = arc_provider.rotate_key(key_name).expect("rotation");
    assert_eq!(rotated.key_version, "v2");

    // Decryption of version 1 ciphertext still succeeds under Vault Transit
    let unwrapped_old = protector.unwrap_private_key(&wrapped).expect("old unwrap");
    assert_eq!(&*unwrapped_old, secret);

    // Raise min_decryption_version to 2 (revokes version 1 decryption)
    emu.set_min_decryption_version(key_name, 2);
    let unwrap_rejected = protector.unwrap_private_key(&wrapped);
    assert!(
        unwrap_rejected.is_err(),
        "Min decryption version enforcement must reject old ciphertext"
    );
}

#[test]
fn test_pkcs11_hsm_provider_lifecycle() {
    let key_label = "vardhan-hsm-cmk";
    let pin = "987654";
    let (provider, _emu) =
        Pkcs11HsmProvider::new_emulator(1, key_label.to_string(), pin.to_string());

    assert_eq!(provider.provider_name(), "hsm-pkcs11");
    assert!(provider.is_production_safe());
    assert_eq!(provider.slot_id(), 1);
    assert_eq!(provider.key_label(), key_label);
    match provider.hardware_mode() {
        Pkcs11HardwareMode::EmulatedSoftHsm { emulated, .. } => assert!(*emulated),
        _ => panic!("Expected emulated SoftHSM for test execution"),
    }

    let secret = b"PKCS11-HSM-WRAPPED-PRIVATE-KEY";
    let wrapped = provider.wrap_private_key(secret).expect("HSM wrap");
    let unwrapped = provider.unwrap_private_key(&wrapped).expect("HSM unwrap");
    assert_eq!(&*unwrapped, secret);

    // Test PIN authentication security
    let token = Pkcs11SoftHsmEmulator::new(2, "TOKEN-LOCK-TEST", "correct_pin");
    assert!(
        token.login("correct_pin").is_err(),
        "Must open session first"
    );
    token.open_session().expect("open session");

    // Three consecutive failed PIN attempts must lock the token
    assert!(token.login("bad_1").is_err());
    assert!(token.login("bad_2").is_err());
    let lock_err = token
        .login("bad_3")
        .expect_err("3rd bad PIN must lock token");
    assert!(lock_err.to_string().contains("CKR_PIN_LOCKED"));

    // Subsequent logins with even the correct PIN are blocked once locked
    let blocked = token
        .login("correct_pin")
        .expect_err("Locked token rejects correct PIN");
    assert!(blocked.to_string().contains("CKR_PIN_LOCKED"));
}

#[test]
fn test_multi_version_key_rotation_and_historical_verification() {
    let dir = tempdir().expect("tempdir");
    let dir_path = dir.path();

    // Use AWS KMS provider for envelope protection
    let key_id = "arn:aws:kms:us-east-1:123456789012:key/rotation-test-key";
    let (aws_provider, _) =
        AwsKmsProvider::new_emulator(key_id.to_string(), "us-east-1".to_string());
    let arc_provider = Arc::new(aws_provider);
    let protector = KmsKeyProtectionProvider::new(arc_provider.clone(), key_id.to_string());

    // ── Generation: Keystore Version 1 ──────────────────────────────────────
    let mut ks = VardhanKeystore::generate();
    ks.save_to_dir_with_provider(dir_path, &protector)
        .expect("initial save");

    let v1_ed_fp = ks.ed25519_identity().public_key_fingerprint.clone();
    let v1_ml_fp = ks.mldsa87_identity().public_key_fingerprint.clone();
    assert_eq!(ks.ed25519_identity().key_version, 1);

    // Contract payload 1 sealed with version 1 keys
    let contract_payload_1 = b"TRANSACTION-1001-SETTLED-UNDER-KEY-V1";
    let hash_1 = blake3::hash(contract_payload_1);
    let sig_ed_1 = ks.sign_ed25519(hash_1.as_bytes());
    let sig_ml_1 = ks.sign_mldsa87(hash_1.as_bytes());

    assert_eq!(sig_ed_1.key_identity.public_key_fingerprint, v1_ed_fp);
    assert_eq!(sig_ml_1.key_identity.public_key_fingerprint, v1_ml_fp);

    // ── Rotation 1: Advance to Keystore Version 2 ───────────────────────────
    let report_1 = ks
        .rotate_keys_with_provider(dir_path, &protector)
        .expect("rotation to v2");
    assert_eq!(report_1.key_version, 2);
    assert_eq!(report_1.previous_ed25519_fingerprint, v1_ed_fp);
    assert_ne!(report_1.new_ed25519_fingerprint, v1_ed_fp);

    let v2_ed_fp = ks.ed25519_identity().public_key_fingerprint.clone();
    assert_eq!(ks.ed25519_identity().key_version, 2);

    // Contract payload 2 sealed with version 2 keys
    let contract_payload_2 = b"TRANSACTION-2002-SETTLED-UNDER-KEY-V2";
    let hash_2 = blake3::hash(contract_payload_2);
    let sig_ed_2 = ks.sign_ed25519(hash_2.as_bytes());
    assert_eq!(sig_ed_2.key_identity.public_key_fingerprint, v2_ed_fp);

    // ── Rotation 2: Advance to Keystore Version 3 ───────────────────────────
    let report_2 = ks
        .rotate_keys_with_provider(dir_path, &protector)
        .expect("rotation to v3");
    assert_eq!(report_2.key_version, 3);
    assert_eq!(report_2.previous_ed25519_fingerprint, v2_ed_fp);

    let v3_ed_fp = ks.ed25519_identity().public_key_fingerprint.clone();
    assert_eq!(ks.ed25519_identity().key_version, 3);

    // ── Verification: Validate all 3 versions across history ────────────────
    // Reload keystore from disk to prove persistence
    let mut reloaded_ks = VardhanKeystore::load_from_dir_with_provider(dir_path, &protector)
        .expect("reload keystore v3");
    assert_eq!(reloaded_ks.ed25519_identity().key_version, 3);

    // Verify v3 lookup -> active
    let v3_lookup = reloaded_ks
        .lookup_public_key(dir_path, &v3_ed_fp)
        .expect("lookup v3")
        .expect("v3 found");
    assert_eq!(v3_lookup.1, KeyAlgorithm::Ed25519);
    assert_eq!(v3_lookup.2, KeyStatus::Active);

    // Verify v2 lookup -> retired historical key
    let v2_lookup = reloaded_ks
        .lookup_public_key(dir_path, &v2_ed_fp)
        .expect("lookup v2")
        .expect("v2 found");
    assert_eq!(v2_lookup.1, KeyAlgorithm::Ed25519);
    assert_eq!(v2_lookup.2, KeyStatus::Retired);

    // Verify v1 lookup -> retired historical key
    let v1_lookup = reloaded_ks
        .lookup_public_key(dir_path, &v1_ed_fp)
        .expect("lookup v1")
        .expect("v1 found");
    assert_eq!(v1_lookup.1, KeyAlgorithm::Ed25519);
    assert_eq!(v1_lookup.2, KeyStatus::Retired);

    // Verify Ed25519 signature from v1 against recovered v1 historical public key
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    let v1_pk_bytes: [u8; 32] = v1_lookup.0.try_into().expect("32 bytes pk");
    let v1_vk = VerifyingKey::from_bytes(&v1_pk_bytes).expect("valid verifying key");
    let sig_1_bytes = hex::decode(&sig_ed_1.signature_hex).expect("decode sig 1");
    let sig_1: Signature = Signature::from_bytes(sig_1_bytes.as_slice().try_into().unwrap());
    v1_vk
        .verify(hash_1.as_bytes(), &sig_1)
        .expect("historical receipt 1 verification must succeed");

    // Verify Ed25519 signature from v2 against recovered v2 historical public key
    let v2_pk_bytes: [u8; 32] = v2_lookup.0.try_into().expect("32 bytes pk");
    let v2_vk = VerifyingKey::from_bytes(&v2_pk_bytes).expect("valid verifying key");
    let sig_2_bytes = hex::decode(&sig_ed_2.signature_hex).expect("decode sig 2");
    let sig_2: Signature = Signature::from_bytes(sig_2_bytes.as_slice().try_into().unwrap());
    v2_vk
        .verify(hash_2.as_bytes(), &sig_2)
        .expect("historical receipt 2 verification must succeed");

    // ── Key Revocation: Compromise drill flags historical key ───────────────
    reloaded_ks
        .revoke_key(
            dir_path,
            &v1_ed_fp,
            "Emergency revocation: simulated compromise drill",
            &protector,
        )
        .expect("revoke v1");

    let v1_revoked_lookup = reloaded_ks
        .lookup_public_key(dir_path, &v1_ed_fp)
        .expect("lookup v1 revoked")
        .expect("v1 entry found");
    assert_eq!(v1_revoked_lookup.2, KeyStatus::Revoked);

    let registry = HistoricalKeyRegistry::load_from_dir(dir_path).expect("load registry");
    assert!(registry.is_revoked(&v1_ed_fp));
    assert!(!registry.is_revoked(&v2_ed_fp));
}

#[test]
fn test_zero_private_key_material_exposure() {
    let dir = tempdir().expect("tempdir");
    let dir_path = dir.path();

    let key_id = "arn:aws:kms:us-east-1:123456789012:key/zero-leak-test";
    let (aws_provider, _) =
        AwsKmsProvider::new_emulator(key_id.to_string(), "us-east-1".to_string());
    let arc_provider = Arc::new(aws_provider);
    let protector = KmsKeyProtectionProvider::new(arc_provider.clone(), key_id.to_string());

    let mut ks = VardhanKeystore::generate();
    ks.save_to_dir_with_provider(dir_path, &protector)
        .expect("save");

    // Rotate to generate historical records
    ks.rotate_keys_with_provider(dir_path, &protector)
        .expect("rotate");

    // Inspect keystore_meta.json
    let meta_content =
        std::fs::read_to_string(dir_path.join("keystore_meta.json")).expect("read meta");
    assert!(
        !meta_content.contains("ed25519_key"),
        "Metadata must not contain private key field"
    );
    assert!(
        !meta_content.contains("mldsa87_secret"),
        "Metadata must not contain secret key field"
    );

    // Inspect historical_keys.json
    let history_content =
        std::fs::read_to_string(dir_path.join("historical_keys.json")).expect("read history");
    assert!(
        !history_content.contains("private"),
        "Historical registry must contain only public material"
    );
    assert!(
        !history_content.contains("secret"),
        "Historical registry must contain only public material"
    );

    // Inspect audit logs
    let records = arc_provider.audit_records().expect("audit logs");
    for record in records {
        let record_json = serde_json::to_string(&record).expect("serialize record");
        assert!(
            !record_json.contains("private_key"),
            "Audit logs must not contain private key data"
        );
        assert!(
            !record_json.contains("secret_key"),
            "Audit logs must not contain secret key data"
        );
    }
}
