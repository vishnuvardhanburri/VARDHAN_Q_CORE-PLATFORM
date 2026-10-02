use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use core_crypto::QuantumNodeIdentity;
use ledger_sync::{LedgerBlock, MerkleLedger};
use rand::RngCore;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use thiserror::Error;
use zeroize::Zeroizing;

#[derive(Error, Debug)]
pub enum PersistenceError {
    #[error("I/O Error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization Error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Decryption / Key Vault Error")]
    CryptoError,
    #[error("Ledger Error: {0}")]
    Ledger(#[from] ledger_sync::LedgerError),
}

/// A passphrase-based key protector that uses Argon2 for key derivation
/// and AES-256-GCM for envelope encryption.
pub struct HardenedLocalKeyProtector {
    passphrase: Zeroizing<Vec<u8>>,
}

impl HardenedLocalKeyProtector {
    pub fn new(passphrase: &[u8]) -> Self {
        Self {
            passphrase: Zeroizing::new(passphrase.to_vec()),
        }
    }

    fn derive_key(&self, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, PersistenceError> {
        let mut derived_key = Zeroizing::new([0u8; 32]);
        Argon2::default()
            .hash_password_into(&self.passphrase, salt, derived_key.as_mut())
            .map_err(|_| PersistenceError::CryptoError)?;
        Ok(derived_key)
    }
}

impl core_crypto::vault::KeyProtector for HardenedLocalKeyProtector {
    fn provider_name(&self) -> &'static str {
        "hardened-local"
    }

    fn wrap(&self, plaintext: &[u8]) -> Result<Vec<u8>, core_crypto::vault::VaultError> {
        let mut salt = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);

        let key = self
            .derive_key(&salt)
            .map_err(|e| core_crypto::vault::VaultError::Crypto(e.to_string()))?;
        let cipher = Aes256Gcm::new(&(*key).into());
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher.encrypt(nonce, plaintext).map_err(|e| {
            core_crypto::vault::VaultError::Crypto(format!("Encryption failed: {:?}", e))
        })?;

        let mut payload = salt.to_vec();
        payload.extend_from_slice(&nonce_bytes);
        payload.extend_from_slice(&ciphertext);
        Ok(payload)
    }

    fn unwrap(&self, ciphertext: &[u8]) -> Result<Vec<u8>, core_crypto::vault::VaultError> {
        if ciphertext.len() < 28 {
            // 16 salt + 12 nonce
            return Err(core_crypto::vault::VaultError::Crypto(
                "Ciphertext too short".into(),
            ));
        }
        let salt = &ciphertext[..16];
        let nonce_bytes = &ciphertext[16..28];
        let data = &ciphertext[28..];

        let key = self
            .derive_key(salt)
            .map_err(|e| core_crypto::vault::VaultError::Crypto(e.to_string()))?;
        let cipher = Aes256Gcm::new(&(*key).into());
        let nonce = Nonce::from_slice(nonce_bytes);

        cipher.decrypt(nonce, data).map_err(|e| {
            core_crypto::vault::VaultError::Crypto(format!("Decryption failed: {:?}", e))
        })
    }
}

/// Append-Only Write-Ahead Log (WAL) Ledger Disk Storage
pub struct DiskLedgerWal {
    file_path: String,
}

impl DiskLedgerWal {
    pub fn new(path: impl Into<String>) -> Self {
        Self {
            file_path: path.into(),
        }
    }

    pub fn append(&self, block: &LedgerBlock) -> Result<(), PersistenceError> {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.file_path)?;

        let json = serde_json::to_string(block)?;
        writeln!(file, "{}", json)?;
        file.flush()?;
        Ok(())
    }

    pub async fn replay_into_ledger(
        &self,
        ledger: &MerkleLedger,
        dsa_pub_key: &[u8],
    ) -> Result<usize, PersistenceError> {
        if !Path::new(&self.file_path).exists() {
            return Ok(0);
        }

        let file = File::open(&self.file_path)?;
        let reader = BufReader::new(file);
        let mut count = 0;

        for line in reader.lines() {
            let line_str = line?;
            if line_str.trim().is_empty() {
                continue;
            }
            let block: LedgerBlock = serde_json::from_str(&line_str)?;
            ledger.append_block(block, dsa_pub_key).await?;
            count += 1;
        }

        Ok(count)
    }
}
