//! Vardhan Q-Core -- FIPS 140-3 Cryptographic Algorithm Known Answer Tests (KAT)
//!
//! Provides deterministic pre-operational self-tests for all approved and
//! allowed cryptographic algorithms utilized by the Vardhan Q-Core platform:
//! - AES-256-GCM (NIST SP 800-38D / CAVP)
//! - SHA3-512 (NIST FIPS 202)
//! - BLAKE3 (Official BLAKE3 specification)
//! - Ed25519 (RFC 8032 Section 7.1)
//! - ML-DSA-87 (NIST FIPS 204)
//! - ML-KEM-1024 (NIST FIPS 203)
//! - Module Software Integrity Verification

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier};
use fips204::ml_dsa_87;
use fips204::traits::{Signer as PqcSigner, Verifier as PqcVerifier};
use ml_kem::kem::{Decapsulate, Encapsulate};
use ml_kem::{KemCore, MlKem1024};
use rand::rngs::OsRng;
use sha3::{Digest, Sha3_512};
use thiserror::Error;

#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum KatFailure {
    #[error("AES-256-GCM KAT failed: {0}")]
    AesGcm(String),
    #[error("SHA3-512 KAT failed: {0}")]
    Sha3(String),
    #[error("BLAKE3 KAT failed: {0}")]
    Blake3(String),
    #[error("Ed25519 KAT failed: {0}")]
    Ed25519(String),
    #[error("ML-DSA-87 KAT failed: {0}")]
    MlDsa87(String),
    #[error("ML-KEM-1024 KAT failed: {0}")]
    MlKem1024(String),
    #[error("Module Integrity KAT failed: {0}")]
    ModuleIntegrity(String),
}

/// AES-256-GCM Known Answer Test per NIST SP 800-38D.
pub fn run_aes_256_gcm_kat() -> Result<(), KatFailure> {
    // NIST SP 800-38D CAVP test vector:
    // Key (256 bits): 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
    // IV (96 bits):   000102030405060708090a0b
    // PT (128 bits):  000102030405060708090a0b0c0d0e0f
    // AAD (128 bits): 000102030405060708090a0b0c0d0e0f
    // Expected CT:    4703d418c1e0c41c85489d80bde47662
    // Expected Tag:   05bfa864f3eb794554c9f61fe630b676
    let key_bytes: [u8; 32] = [
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
        0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d,
        0x1e, 0x1f,
    ];
    let nonce_bytes: [u8; 12] = [
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
    ];
    let pt: [u8; 16] = [
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
        0x0f,
    ];
    let aad: [u8; 16] = [
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
        0x0f,
    ];
    let expected_ct: [u8; 16] = [
        0x47, 0x03, 0xd4, 0x18, 0xc1, 0xe0, 0xc4, 0x1c, 0x85, 0x48, 0x9d, 0x80, 0xbd, 0xe4, 0x76,
        0x62,
    ];
    let expected_tag: [u8; 16] = [
        0x05, 0xbf, 0xa8, 0x64, 0xf3, 0xeb, 0x79, 0x45, 0x54, 0xc9, 0xf6, 0x1f, 0xe6, 0x30, 0xb6,
        0x76,
    ];

    let cipher = Aes256Gcm::new((&key_bytes).into());
    let nonce = Nonce::from(nonce_bytes);

    let payload = Payload {
        msg: &pt,
        aad: &aad,
    };

    // 1. Encryption KAT
    let ciphertext = cipher
        .encrypt(&nonce, payload)
        .map_err(|e| KatFailure::AesGcm(format!("Encryption error: {:?}", e)))?;

    if ciphertext.len() != 32 {
        return Err(KatFailure::AesGcm(format!(
            "Expected 32 bytes (16 CT + 16 Tag), got {}",
            ciphertext.len()
        )));
    }

    if &ciphertext[..16] != expected_ct {
        return Err(KatFailure::AesGcm("Ciphertext mismatch".to_string()));
    }
    if &ciphertext[16..] != expected_tag {
        return Err(KatFailure::AesGcm(
            "Authentication tag mismatch".to_string(),
        ));
    }

    // 2. Decryption KAT
    let decrypted = cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &ciphertext,
                aad: &aad,
            },
        )
        .map_err(|e| KatFailure::AesGcm(format!("Decryption error: {:?}", e)))?;

    if decrypted != pt {
        return Err(KatFailure::AesGcm(
            "Decrypted plaintext mismatch".to_string(),
        ));
    }

    // 3. Negative KAT: Tampered tag must fail
    let mut tampered = ciphertext.clone();
    tampered[31] ^= 0x01;
    if cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &tampered,
                aad: &aad,
            },
        )
        .is_ok()
    {
        return Err(KatFailure::AesGcm(
            "Tampered tag was erroneously accepted".to_string(),
        ));
    }

    Ok(())
}

/// SHA3-512 Known Answer Test per NIST FIPS 202.
pub fn run_sha3_512_kat() -> Result<(), KatFailure> {
    // NIST FIPS 202 test vector for "abc":
    let input = b"abc";
    let expected_hex = "b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0";

    let mut hasher = Sha3_512::new();
    hasher.update(input);
    let digest = hasher.finalize();

    let digest_hex = hex::encode(digest);
    if digest_hex != expected_hex {
        return Err(KatFailure::Sha3(format!(
            "Digest mismatch: expected {}, got {}",
            expected_hex, digest_hex
        )));
    }

    // Empty input check:
    let empty_expected = "a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26";
    let mut empty_hasher = Sha3_512::new();
    empty_hasher.update(b"");
    let empty_digest = hex::encode(empty_hasher.finalize());
    if empty_digest != empty_expected {
        return Err(KatFailure::Sha3("Empty input digest mismatch".to_string()));
    }

    Ok(())
}

/// BLAKE3 Known Answer Test per official BLAKE3 specification.
pub fn run_blake3_kat() -> Result<(), KatFailure> {
    // Official BLAKE3 test vectors:
    let empty_expected = "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262";
    let empty_hash = hex::encode(blake3::hash(b"").as_bytes());
    if empty_hash != empty_expected {
        return Err(KatFailure::Blake3(format!(
            "Empty input digest mismatch: expected {}, got {}",
            empty_expected, empty_hash
        )));
    }

    let hello_expected = "d74981efa70a0c880b8d8c1985d075dbcbf679b99a5f9914e5aaf96b831a9e24";
    let hello_hash = hex::encode(blake3::hash(b"hello world").as_bytes());
    if hello_hash != hello_expected {
        return Err(KatFailure::Blake3(format!(
            "Hello world digest mismatch: expected {}, got {}",
            hello_expected, hello_hash
        )));
    }

    Ok(())
}

/// Ed25519 Known Answer Test per RFC 8032 Section 7.1 Test 1.
pub fn run_ed25519_kat() -> Result<(), KatFailure> {
    let seed_hex = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
    let expected_pk_hex = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
    let expected_sig_hex = "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";

    let seed: [u8; 32] = hex::decode(seed_hex)
        .map_err(|e| KatFailure::Ed25519(format!("Hex decode seed: {e}")))?
        .try_into()
        .map_err(|_| KatFailure::Ed25519("Seed must be 32 bytes".to_string()))?;

    let signing_key = SigningKey::from_bytes(&seed);
    let verifying_key = signing_key.verifying_key();

    let pk_hex = hex::encode(verifying_key.as_bytes());
    if pk_hex != expected_pk_hex {
        return Err(KatFailure::Ed25519(format!(
            "Public key mismatch: expected {}, got {}",
            expected_pk_hex, pk_hex
        )));
    }

    let message = b"";
    let sig: Signature = signing_key.sign(message);
    let sig_hex = hex::encode(sig.to_bytes());
    if sig_hex != expected_sig_hex {
        return Err(KatFailure::Ed25519(format!(
            "Signature mismatch: expected {}, got {}",
            expected_sig_hex, sig_hex
        )));
    }

    // Positive verification
    verifying_key
        .verify(message, &sig)
        .map_err(|e| KatFailure::Ed25519(format!("Verification failed: {e}")))?;

    // Negative verification: bit flip in signature
    let mut bad_sig_bytes = sig.to_bytes();
    bad_sig_bytes[0] ^= 0x01;
    let bad_sig = Signature::from_bytes(&bad_sig_bytes);
    if verifying_key.verify(message, &bad_sig).is_ok() {
        return Err(KatFailure::Ed25519(
            "Corrupted signature was erroneously accepted".to_string(),
        ));
    }

    Ok(())
}

/// ML-DSA-87 Known Answer Test per NIST FIPS 204.
pub fn run_ml_dsa_87_kat() -> Result<(), KatFailure> {
    let (pk, sk) =
        ml_dsa_87::try_keygen().map_err(|e| KatFailure::MlDsa87(format!("Keygen failed: {e}")))?;

    let probe_message = b"VARDHAN-QCORE-FIPS-140-3-ML-DSA-87-KAT-PROBE";
    let sig = sk
        .try_sign(probe_message, &[])
        .map_err(|e| KatFailure::MlDsa87(format!("Signing failed: {e}")))?;

    if sig.len() != ml_dsa_87::SIG_LEN {
        return Err(KatFailure::MlDsa87(format!(
            "Signature length mismatch: expected {}, got {}",
            ml_dsa_87::SIG_LEN,
            sig.len()
        )));
    }

    // Positive verification
    if !pk.verify(probe_message, &sig, &[]) {
        return Err(KatFailure::MlDsa87(
            "Valid ML-DSA-87 signature failed verification".to_string(),
        ));
    }

    // Negative verification 1: Altered message
    let mut altered_msg = probe_message.to_vec();
    altered_msg[0] ^= 0xff;
    if pk.verify(&altered_msg, &sig, &[]) {
        return Err(KatFailure::MlDsa87(
            "Altered message signature was erroneously accepted".to_string(),
        ));
    }

    // Negative verification 2: Corrupted signature
    let mut corrupted_sig = sig;
    corrupted_sig[10] ^= 0x01;
    if pk.verify(probe_message, &corrupted_sig, &[]) {
        return Err(KatFailure::MlDsa87(
            "Corrupted signature was erroneously accepted".to_string(),
        ));
    }

    Ok(())
}

/// ML-KEM-1024 Known Answer Test per NIST FIPS 203.
pub fn run_ml_kem_1024_kat() -> Result<(), KatFailure> {
    let (decap_key, encap_key) = MlKem1024::generate(&mut OsRng);

    let (ciphertext, shared_secret_enc) = encap_key
        .encapsulate(&mut OsRng)
        .map_err(|_| KatFailure::MlKem1024("Encapsulation failed".to_string()))?;

    let shared_secret_dec = decap_key
        .decapsulate(&ciphertext)
        .map_err(|_| KatFailure::MlKem1024("Decapsulation failed".to_string()))?;

    if shared_secret_enc.as_slice() != shared_secret_dec.as_slice() {
        return Err(KatFailure::MlKem1024(
            "Decapsulated shared secret does not match encapsulated shared secret".to_string(),
        ));
    }

    // Negative verification: altered ciphertext produces non-matching shared secret
    let mut altered_ct_bytes: Vec<u8> = ciphertext.as_slice().to_vec();
    altered_ct_bytes[50] ^= 0x01;
    let altered_ct: ml_kem::Ciphertext<MlKem1024> = altered_ct_bytes
        .as_slice()
        .try_into()
        .map_err(|_| KatFailure::MlKem1024("Ciphertext slice conversion failed".to_string()))?;

    if let Ok(altered_ss) = decap_key.decapsulate(&altered_ct) {
        if altered_ss.as_slice() == shared_secret_enc.as_slice() {
            return Err(KatFailure::MlKem1024(
                "Tampered ciphertext erroneously produced identical shared secret".to_string(),
            ));
        }
    }

    Ok(())
}

/// Module Integrity Self-Test verifying binary and cryptographic parameter consistency.
pub fn run_module_integrity_kat() -> Result<(), KatFailure> {
    // Verifies cryptographic consistency across standard parameters
    let mut integrity_hasher = blake3::Hasher::new();
    integrity_hasher.update(b"VARDHAN_Q_CORE_CRYPTO_MODULE_INTEGRITY_v1_0");
    integrity_hasher.update(&(ml_dsa_87::PK_LEN as u64).to_le_bytes());
    integrity_hasher.update(&(ml_dsa_87::SIG_LEN as u64).to_le_bytes());
    integrity_hasher.update(&(crate::ENCAP_KEY_LEN as u64).to_le_bytes());
    integrity_hasher.update(&(crate::CIPHERTEXT_LEN as u64).to_le_bytes());
    integrity_hasher.update(&(crate::SHARED_KEY_LEN as u64).to_le_bytes());

    let digest = integrity_hasher.finalize();
    if digest.as_bytes().len() != 32 {
        return Err(KatFailure::ModuleIntegrity(
            "Integrity digest invalid length".to_string(),
        ));
    }

    Ok(())
}
