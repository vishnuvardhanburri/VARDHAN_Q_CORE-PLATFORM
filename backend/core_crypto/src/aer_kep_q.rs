//! AER-KEP-Q: Asynchronous Exposure-Resilient Key Establishment — Quarantine/Reissue.
//!
//! Initial production integration slice. This module deliberately does not claim
//! retroactive protection for ciphertexts from an epoch whose complete secret
//! state has been exposed. Exposure causes quarantine and future use moves to a
//! fresh epoch.

use crate::QuantumNodeIdentity;
use hkdf::Hkdf;
use ml_kem::kem::{Decapsulate, Encapsulate};
use ml_kem::{Ciphertext, EncodedSizeUser, KemCore, MlKem1024};
use rand::rngs::OsRng;
use sha3::{Digest, Sha3_512};
use std::collections::HashSet;
use thiserror::Error;
use zeroize::Zeroizing;

pub use crate::exposure_detector;

pub const AER_KEY_LEN: usize = 32;
pub const AER_CIPHERTEXT_LEN: usize = 1568;
const DOMAIN_TAG: &[u8] = b"VARDHAN-AER-KEP-Q-v2";
const KDF_INFO: &[u8] = b"AER-KEP-Q SESSION KEY";
/// Context tag for transaction binding in session key derivation.
const TXN_BINDING_TAG: &[u8] = b"AER-KEP-Q-TXN";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EpochStatus {
    Active,
    Quarantined,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EpochDescriptor {
    pub domain_id: String,
    pub epoch: u64,
    pub status: EpochStatus,
    pub encapsulation_key: Vec<u8>,
    pub signature: Vec<u8>,
}

impl EpochDescriptor {
    pub fn signable_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(self.domain_id.as_bytes());
        bytes.extend_from_slice(&self.epoch.to_be_bytes());
        bytes.push(if self.status == EpochStatus::Active {
            1
        } else {
            0
        });
        bytes.extend_from_slice(&self.encapsulation_key);
        bytes
    }
}

#[derive(Debug, Error)]
pub enum AerKepQError {
    #[error("epoch is not active")]
    EpochNotActive,
    #[error("epoch descriptor is invalid")]
    InvalidDescriptor,
    #[error("ciphertext has invalid length")]
    InvalidCiphertext,
    #[error("ciphertext decapsulation failed")]
    DecapsulationFailed,
    #[error("message id has already been accepted")]
    Replay,
    #[error("key derivation failed")]
    KeyDerivationFailed,
    #[error("descriptor signature verification failed")]
    InvalidSignature,
}

pub struct AerKepQ {
    domain_id: String,
    epoch: u64,
    status: EpochStatus,
    encapsulation_key: Option<<MlKem1024 as KemCore>::EncapsulationKey>,
    decapsulation_key: Option<<MlKem1024 as KemCore>::DecapsulationKey>,
    accepted_message_ids: HashSet<u64>,
}

impl AerKepQ {
    pub fn new(domain_id: impl Into<String>, epoch: u64) -> Result<Self, AerKepQError> {
        let domain_id = domain_id.into();
        if domain_id.is_empty() {
            return Err(AerKepQError::InvalidDescriptor);
        }
        let (decapsulation_key, encapsulation_key) = MlKem1024::generate(&mut OsRng);
        Ok(Self {
            domain_id,
            epoch,
            status: EpochStatus::Active,
            encapsulation_key: Some(encapsulation_key),
            decapsulation_key: Some(decapsulation_key),
            accepted_message_ids: HashSet::new(),
        })
    }

    pub fn status(&self) -> EpochStatus {
        self.status
    }
    pub fn epoch(&self) -> u64 {
        self.epoch
    }

    pub fn descriptor(
        &self,
        signer: &QuantumNodeIdentity,
    ) -> Result<EpochDescriptor, AerKepQError> {
        if self.status != EpochStatus::Active {
            return Err(AerKepQError::EpochNotActive);
        }
        let key = self
            .encapsulation_key
            .as_ref()
            .ok_or(AerKepQError::EpochNotActive)?;
        let mut desc = EpochDescriptor {
            domain_id: self.domain_id.clone(),
            epoch: self.epoch,
            status: self.status,
            encapsulation_key: key.as_bytes().to_vec(),
            signature: vec![],
        };
        let payload = desc.signable_bytes();
        desc.signature = signer
            .sign_payload(&payload)
            .map_err(|_| AerKepQError::InvalidSignature)?;
        Ok(desc)
    }

    pub fn encapsulate(
        descriptor: &EpochDescriptor,
        verifier_pub_bytes: &[u8],
        message_id: u64,
        context: &[u8],
        transaction_id: &str,
    ) -> Result<(Vec<u8>, Vec<u8>), AerKepQError> {
        if descriptor.status != EpochStatus::Active || descriptor.encapsulation_key.len() != 1568 {
            return Err(AerKepQError::InvalidDescriptor);
        }
        if transaction_id.is_empty() {
            return Err(AerKepQError::InvalidDescriptor);
        }
        let payload = descriptor.signable_bytes();
        if !QuantumNodeIdentity::verify_signature(
            verifier_pub_bytes,
            &payload,
            &descriptor.signature,
        ) {
            return Err(AerKepQError::InvalidSignature);
        }
        let key_bytes: [u8; 1568] = descriptor.encapsulation_key.as_slice().try_into().unwrap();
        let encoded = ml_kem::Encoded::<<MlKem1024 as KemCore>::EncapsulationKey>::from(key_bytes);
        let key = <MlKem1024 as KemCore>::EncapsulationKey::from_bytes(&encoded);
        let (ciphertext, shared_secret) = key
            .encapsulate(&mut OsRng)
            .map_err(|_| AerKepQError::InvalidDescriptor)?;
        let ciphertext_bytes = ciphertext.to_vec();
        let session_key = derive_session_key(
            &descriptor.domain_id,
            descriptor.epoch,
            message_id,
            &ciphertext_bytes,
            context,
            shared_secret.as_ref(),
            transaction_id,
        )?;
        Ok((ciphertext_bytes, session_key))
    }

    pub fn decapsulate(
        &mut self,
        ciphertext_bytes: &[u8],
        message_id: u64,
        context: &[u8],
        transaction_id: &str,
    ) -> Result<Vec<u8>, AerKepQError> {
        if self.status != EpochStatus::Active {
            return Err(AerKepQError::EpochNotActive);
        }
        if self.accepted_message_ids.contains(&message_id) {
            return Err(AerKepQError::Replay);
        }
        if transaction_id.is_empty() {
            return Err(AerKepQError::InvalidDescriptor);
        }
        if ciphertext_bytes.len() != AER_CIPHERTEXT_LEN {
            return Err(AerKepQError::InvalidCiphertext);
        }
        let ciphertext_array: [u8; AER_CIPHERTEXT_LEN] = ciphertext_bytes.try_into().unwrap();
        let ciphertext: Ciphertext<MlKem1024> = ciphertext_array.into();
        let key = self
            .decapsulation_key
            .as_ref()
            .ok_or(AerKepQError::EpochNotActive)?;
        let shared_secret = key
            .decapsulate(&ciphertext)
            .map_err(|_| AerKepQError::DecapsulationFailed)?;
        let session_key = derive_session_key(
            &self.domain_id,
            self.epoch,
            message_id,
            ciphertext_bytes,
            context,
            shared_secret.as_ref(),
            transaction_id,
        )?;
        self.accepted_message_ids.insert(message_id);
        Ok(session_key)
    }

    pub fn quarantine(&mut self) {
        self.status = EpochStatus::Quarantined;
        self.decapsulation_key = None;
        self.encapsulation_key = None;
    }
}

fn derive_session_key(
    domain_id: &str,
    epoch: u64,
    message_id: u64,
    ciphertext: &[u8],
    context: &[u8],
    shared_secret: &[u8],
    transaction_id: &str,
) -> Result<Vec<u8>, AerKepQError> {
    let mut hasher = Sha3_512::new();
    hasher.update(DOMAIN_TAG);
    append_len_prefixed(&mut hasher, domain_id.as_bytes());
    hasher.update(epoch.to_be_bytes());
    hasher.update(message_id.to_be_bytes());
    append_len_prefixed(&mut hasher, ciphertext);
    append_len_prefixed(&mut hasher, context);
    // F-005: Bind session key to the specific transaction_id
    hasher.update(TXN_BINDING_TAG);
    append_len_prefixed(&mut hasher, transaction_id.as_bytes());
    let transcript = hasher.finalize();
    let secret = Zeroizing::new(shared_secret.to_vec());
    // F-005: Include transaction_id in HKDF info to prevent key reuse
    // across different transactions with the same epoch/message_id
    let mut hkdf_info = Vec::with_capacity(KDF_INFO.len() + transaction_id.len() + 2);
    hkdf_info.extend_from_slice(KDF_INFO);
    hkdf_info.extend_from_slice(transaction_id.as_bytes());
    let hk = Hkdf::<Sha3_512>::new(Some(&transcript), secret.as_ref());
    let mut output = [0u8; AER_KEY_LEN];
    hk.expand(&hkdf_info, &mut output)
        .map_err(|_| AerKepQError::KeyDerivationFailed)?;
    Ok(output.to_vec())
}

fn append_len_prefixed<D: Digest>(hasher: &mut D, value: &[u8]) {
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_derives_same_key() {
        let node_a = QuantumNodeIdentity::generate_node_identity().unwrap();
        let receiver = AerKepQ::new("bank-a", 1).unwrap();
        let descriptor = receiver.descriptor(&node_a).unwrap();
        let dsa_pub = node_a.dsa_public_key_bytes();
        let (ciphertext, sender_key) =
            AerKepQ::encapsulate(&descriptor, &dsa_pub, 7, b"txn-1", "tx-id-1").unwrap();
        let mut receiver = receiver;
        let receiver_key = receiver
            .decapsulate(&ciphertext, 7, b"txn-1", "tx-id-1")
            .unwrap();
        assert_eq!(sender_key, receiver_key);
        assert_eq!(sender_key.len(), AER_KEY_LEN);
    }

    #[test]
    fn context_binding_changes_key() {
        let node_a = QuantumNodeIdentity::generate_node_identity().unwrap();
        let receiver = AerKepQ::new("bank-a", 1).unwrap();
        let descriptor = receiver.descriptor(&node_a).unwrap();
        let dsa_pub = node_a.dsa_public_key_bytes();
        let (ciphertext, key_a) =
            AerKepQ::encapsulate(&descriptor, &dsa_pub, 8, b"context-a", "tx-a").unwrap();
        let mut receiver = receiver;
        let key_b = receiver
            .decapsulate(&ciphertext, 8, b"context-a", "tx-b")
            .unwrap();
        assert_ne!(key_a, key_b);
    }

    #[test]
    fn transaction_binding_changes_key() {
        // F-005: Different transaction_id with same context should produce
        // different session keys.
        let node_a = QuantumNodeIdentity::generate_node_identity().unwrap();
        let receiver = AerKepQ::new("bank-a", 1).unwrap();
        let descriptor = receiver.descriptor(&node_a).unwrap();
        let dsa_pub = node_a.dsa_public_key_bytes();

        let (ct1, key1) = AerKepQ::encapsulate(&descriptor, &dsa_pub, 7, b"ctx", "tx-1").unwrap();
        let (_, key2) = AerKepQ::encapsulate(&descriptor, &dsa_pub, 7, b"ctx", "tx-2").unwrap();

        assert_ne!(
            key1, key2,
            "Different transaction_ids must produce different session keys"
        );
        assert_eq!(key1.len(), AER_KEY_LEN);
        assert_eq!(key2.len(), AER_KEY_LEN);

        // Verify the key can be decapsulated with the correct transaction_id
        let mut receiver = receiver;
        let dec_key1 = receiver.decapsulate(&ct1, 7, b"ctx", "tx-1").unwrap();
        assert_eq!(key1, dec_key1);
    }

    #[test]
    fn empty_transaction_id_rejected() {
        let node_a = QuantumNodeIdentity::generate_node_identity().unwrap();
        let receiver = AerKepQ::new("bank-a", 1).unwrap();
        let descriptor = receiver.descriptor(&node_a).unwrap();
        let dsa_pub = node_a.dsa_public_key_bytes();

        // Encapsulate with empty transaction_id should be rejected
        let result = AerKepQ::encapsulate(&descriptor, &dsa_pub, 7, b"ctx", "");
        assert!(result.is_err());
        assert!(matches!(result, Err(AerKepQError::InvalidDescriptor)));

        // Decapsulate with empty transaction_id should also be rejected
        let (ciphertext, _) =
            AerKepQ::encapsulate(&descriptor, &dsa_pub, 9, b"ctx", "tx-1").unwrap();
        let mut receiver = receiver;
        let result = receiver.decapsulate(&ciphertext, 9, b"ctx", "");
        assert!(result.is_err());
    }

    #[test]
    fn same_context_same_transaction_same_key() {
        // F-005: Same transaction_id, same context, same epoch → same key
        let node_a = QuantumNodeIdentity::generate_node_identity().unwrap();
        let receiver = AerKepQ::new("bank-a", 1).unwrap();
        let descriptor = receiver.descriptor(&node_a).unwrap();
        let dsa_pub = node_a.dsa_public_key_bytes();
        let (ciphertext, sender_key) =
            AerKepQ::encapsulate(&descriptor, &dsa_pub, 7, b"ctx", "tx-1").unwrap();
        let mut receiver = receiver;
        let receiver_key = receiver
            .decapsulate(&ciphertext, 7, b"ctx", "tx-1")
            .unwrap();
        assert_eq!(sender_key, receiver_key);
    }

    #[test]
    fn replay_is_rejected() {
        let node_a = QuantumNodeIdentity::generate_node_identity().unwrap();
        let receiver = AerKepQ::new("bank-a", 1).unwrap();
        let descriptor = receiver.descriptor(&node_a).unwrap();
        let dsa_pub = node_a.dsa_public_key_bytes();
        let (ciphertext, _) =
            AerKepQ::encapsulate(&descriptor, &dsa_pub, 9, b"ctx", "tx-1").unwrap();
        let mut receiver = receiver;
        receiver
            .decapsulate(&ciphertext, 9, b"ctx", "tx-1")
            .unwrap();
        assert!(matches!(
            receiver.decapsulate(&ciphertext, 9, b"ctx", "tx-1"),
            Err(AerKepQError::Replay)
        ));
    }

    #[test]
    fn quarantine_blocks_old_epoch() {
        let node_a = QuantumNodeIdentity::generate_node_identity().unwrap();
        let mut receiver = AerKepQ::new("bank-a", 1).unwrap();
        let descriptor = receiver.descriptor(&node_a).unwrap();
        let dsa_pub = node_a.dsa_public_key_bytes();
        let (ciphertext, _) =
            AerKepQ::encapsulate(&descriptor, &dsa_pub, 10, b"ctx", "tx-1").unwrap();
        receiver.quarantine();
        assert_eq!(receiver.status(), EpochStatus::Quarantined);
        assert!(matches!(
            receiver.decapsulate(&ciphertext, 10, b"ctx", "tx-1"),
            Err(AerKepQError::EpochNotActive)
        ));
        assert!(matches!(
            receiver.descriptor(&node_a),
            Err(AerKepQError::EpochNotActive)
        ));
    }

    #[test]
    fn descriptor_signature_mismatch() {
        let node_a = QuantumNodeIdentity::generate_node_identity().unwrap();
        let node_b = QuantumNodeIdentity::generate_node_identity().unwrap();
        let receiver = AerKepQ::new("bank-a", 1).unwrap();
        let mut descriptor = receiver.descriptor(&node_a).unwrap();
        let dsa_pub_b = node_b.dsa_public_key_bytes();
        assert!(matches!(
            AerKepQ::encapsulate(&descriptor, &dsa_pub_b, 1, b"ctx", "tx-1"),
            Err(AerKepQError::InvalidSignature)
        ));
        descriptor.epoch = 2;
        let dsa_pub_a = node_a.dsa_public_key_bytes();
        assert!(matches!(
            AerKepQ::encapsulate(&descriptor, &dsa_pub_a, 1, b"ctx", "tx-1"),
            Err(AerKepQError::InvalidSignature)
        ));
    }
}
