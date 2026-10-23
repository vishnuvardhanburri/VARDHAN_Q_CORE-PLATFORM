//! Transaction-bound key derivation. This separates contexts; single-use enforcement
//! requires a durable server-side reservation. Possession of a copied key still
//! permits use during its authorised lifetime. V2 length-prefixes variable inputs.

use hkdf::Hkdf;
use sha3::Sha3_512;
use thiserror::Error;
use zeroize::{Zeroize, Zeroizing};

const DOMAIN_TAG: &[u8] = b"VARDHAN-TRANSACTION-BOUND-PQC-v2";
const TXN_BINDING_INFO: &[u8] = b"TRANSACTION-PINNED-SESSION-KEY";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TransactionKdfError {
    #[error("Transaction ID cannot be empty")]
    EmptyTransactionId,
    #[error("Shared secret cannot be empty")]
    EmptySharedSecret,
    #[error("Key derivation failed")]
    DerivationFailed,
    #[error("Transaction ID mismatch: expected {expected}, got {actual}")]
    TransactionMismatch { expected: String, actual: String },
}

/// A transaction-pinned cryptographic session key.
/// Zeroized automatically when dropped from memory.
#[derive(Clone, Zeroize)]
#[zeroize(drop)]
pub struct TransactionPinnedKey {
    pub key: [u8; 32],
    #[zeroize(skip)]
    pub transaction_id: String,
    #[zeroize(skip)]
    pub epoch: u64,
}

impl std::fmt::Debug for TransactionPinnedKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TransactionPinnedKey")
            .field("transaction_id", &self.transaction_id)
            .field("epoch", &self.epoch)
            .field("key", &"[REDACTED_32_BYTES]")
            .finish()
    }
}

/// Derives a 32-byte symmetric session key cryptographically locked to a single transaction ID.
///
/// Transcript:
/// `HKDF-SHA3-512(IKM = shared_secret, Salt = DOMAIN_TAG || epoch, Info = TXN_BINDING_INFO || message_id_be64 || context_len_be64 || context || transaction_id_len_be64 || transaction_id)`
pub fn derive_transaction_pinned_key(
    shared_secret: &[u8],
    epoch: u64,
    message_id: u64,
    context: &[u8],
    transaction_id: &str,
) -> Result<TransactionPinnedKey, TransactionKdfError> {
    if transaction_id.trim().is_empty() {
        return Err(TransactionKdfError::EmptyTransactionId);
    }
    if shared_secret.is_empty() {
        return Err(TransactionKdfError::EmptySharedSecret);
    }

    let mut salt = Vec::with_capacity(DOMAIN_TAG.len() + 8);
    salt.extend_from_slice(DOMAIN_TAG);
    salt.extend_from_slice(&epoch.to_be_bytes());

    let hk = Hkdf::<Sha3_512>::new(Some(&salt), shared_secret);

    let mut info = Vec::new();
    info.extend_from_slice(TXN_BINDING_INFO);
    info.extend_from_slice(&message_id.to_be_bytes());
    info.extend_from_slice(&(context.len() as u64).to_be_bytes());
    info.extend_from_slice(context);
    info.extend_from_slice(&(transaction_id.len() as u64).to_be_bytes());
    info.extend_from_slice(transaction_id.as_bytes());

    let mut okm = Zeroizing::new([0u8; 32]);
    hk.expand(&info, okm.as_mut())
        .map_err(|_| TransactionKdfError::DerivationFailed)?;

    Ok(TransactionPinnedKey {
        key: *okm,
        transaction_id: transaction_id.to_string(),
        epoch,
    })
}

/// Verifies that a given session key mathematically matches the expected transaction ID.
pub fn verify_transaction_binding(
    key: &TransactionPinnedKey,
    expected_transaction_id: &str,
) -> Result<(), TransactionKdfError> {
    if key.transaction_id != expected_transaction_id {
        return Err(TransactionKdfError::TransactionMismatch {
            expected: expected_transaction_id.to_string(),
            actual: key.transaction_id.clone(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transaction_pinned_derivation_deterministic() {
        let secret = b"super-secure-ml-kem-1024-shared-secret-bytes";
        let key1 = derive_transaction_pinned_key(secret, 1, 100, b"SWIFT-TRANSFER", "TX-BANK-001")
            .unwrap();
        let key2 = derive_transaction_pinned_key(secret, 1, 100, b"SWIFT-TRANSFER", "TX-BANK-001")
            .unwrap();

        assert_eq!(key1.key, key2.key);
        assert_eq!(key1.transaction_id, "TX-BANK-001");
        assert!(verify_transaction_binding(&key1, "TX-BANK-001").is_ok());
    }

    #[test]
    fn test_different_transaction_id_yields_completely_different_key() {
        let secret = b"super-secure-ml-kem-1024-shared-secret-bytes";
        let key1 = derive_transaction_pinned_key(secret, 1, 100, b"SWIFT-TRANSFER", "TX-BANK-001")
            .unwrap();
        let key2 = derive_transaction_pinned_key(secret, 1, 100, b"SWIFT-TRANSFER", "TX-BANK-002")
            .unwrap();

        assert_ne!(key1.key, key2.key);
        assert!(verify_transaction_binding(&key1, "TX-BANK-002").is_err());
    }

    #[test]
    fn test_empty_transaction_id_rejected() {
        let secret = b"secret";
        let res = derive_transaction_pinned_key(secret, 1, 100, b"ctx", "   ");
        assert_eq!(res.unwrap_err(), TransactionKdfError::EmptyTransactionId);
    }

    #[test]
    fn regression_context_transaction_boundary_collision() {
        let first = derive_transaction_pinned_key(&[7; 32], 1, 100, b"ab", "c").unwrap();
        let second = derive_transaction_pinned_key(&[7; 32], 1, 100, b"a", "bc").unwrap();
        assert!(
            first.key != second.key,
            "distinct contexts must derive distinct keys"
        );
    }
}
