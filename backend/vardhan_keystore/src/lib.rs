use pqcrypto_mldsa::mldsa87::{keypair as mldsa_keypair, detached_sign as mldsa_sign, SecretKey, PublicKey as MlDsaPublicKey};
use pqcrypto_traits::sign::{PublicKey as PQPublicKey, DetachedSignature as PQDetachedSignature};
use ed25519_dalek::{SigningKey, Signer};
use rand::rngs::OsRng;
use serde::{Serialize, Deserialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum KeyStatus {
    Active,
    Retired,
    Revoked,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum KeyAlgorithm {
    Ed25519,
    MlDsa87,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyIdentity {
    pub key_id: String,
    pub algorithm: KeyAlgorithm,
    pub key_version: u32,
    pub public_key_fingerprint: String,
    pub created_at_ms: u64,
    pub status: KeyStatus,
}

#[derive(Debug, Clone)]
pub struct SigningResult {
    pub key_identity: KeyIdentity,
    pub signature_hex: String,
}

pub struct VardhanKeystore {
    ed25519_key: SigningKey,
    ed25519_identity: KeyIdentity,
    mldsa87_secret: SecretKey,
    mldsa87_public: MlDsaPublicKey,
    mldsa87_identity: KeyIdentity,
}

impl VardhanKeystore {
    pub fn generate() -> Self {
        let mut csprng = OsRng;
        let ed25519_key = SigningKey::generate(&mut csprng);
        let ed25519_pub = ed25519_key.verifying_key();
        
        let (mldsa87_pub, mldsa87_sec) = mldsa_keypair();
        
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let ed25519_fingerprint = hex::encode(blake3::hash(ed25519_pub.as_bytes()).as_bytes());
        let ed25519_identity = KeyIdentity {
            key_id: Uuid::new_v4().to_string(),
            algorithm: KeyAlgorithm::Ed25519,
            key_version: 1,
            public_key_fingerprint: ed25519_fingerprint,
            created_at_ms: now_ms,
            status: KeyStatus::Active,
        };

        let mldsa87_fingerprint = hex::encode(blake3::hash(mldsa87_pub.as_bytes()).as_bytes());
        let mldsa87_identity = KeyIdentity {
            key_id: Uuid::new_v4().to_string(),
            algorithm: KeyAlgorithm::MlDsa87,
            key_version: 1,
            public_key_fingerprint: mldsa87_fingerprint,
            created_at_ms: now_ms,
            status: KeyStatus::Active,
        };

        Self {
            ed25519_key,
            ed25519_identity,
            mldsa87_secret: mldsa87_sec,
            mldsa87_public: mldsa87_pub,
            mldsa87_identity,
        }
    }

    pub fn sign_ed25519(&self, payload: &[u8]) -> SigningResult {
        let signature = self.ed25519_key.sign(payload);
        SigningResult {
            key_identity: self.ed25519_identity.clone(),
            signature_hex: hex::encode(signature.to_bytes()),
        }
    }

    pub fn sign_mldsa87(&self, payload: &[u8]) -> SigningResult {
        let signature = mldsa_sign(payload, &self.mldsa87_secret);
        SigningResult {
            key_identity: self.mldsa87_identity.clone(),
            signature_hex: hex::encode(signature.as_bytes()),
        }
    }

    pub fn ed25519_identity(&self) -> &KeyIdentity {
        &self.ed25519_identity
    }

    pub fn mldsa87_identity(&self) -> &KeyIdentity {
        &self.mldsa87_identity
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keystore_generates_unique_key_ids() {
        let k1 = VardhanKeystore::generate();
        let k2 = VardhanKeystore::generate();
        assert_ne!(k1.ed25519_identity().key_id, k2.ed25519_identity().key_id);
        assert_ne!(k1.mldsa87_identity().key_id, k2.mldsa87_identity().key_id);
    }

    #[test]
    fn test_ed25519_fingerprint_is_stable() {
        let k = VardhanKeystore::generate();
        let res1 = k.sign_ed25519(b"hello");
        let res2 = k.sign_ed25519(b"world");
        assert_eq!(res1.key_identity.public_key_fingerprint, res2.key_identity.public_key_fingerprint);
    }

    #[test]
    fn test_mldsa87_fingerprint_is_stable() {
        let k = VardhanKeystore::generate();
        let res1 = k.sign_mldsa87(b"hello");
        let res2 = k.sign_mldsa87(b"world");
        assert_eq!(res1.key_identity.public_key_fingerprint, res2.key_identity.public_key_fingerprint);
    }

    #[test]
    fn test_signing_produces_nonempty_signatures() {
        let k = VardhanKeystore::generate();
        let res1 = k.sign_ed25519(b"hello");
        let res2 = k.sign_mldsa87(b"world");
        assert!(!res1.signature_hex.is_empty());
        assert!(!res2.signature_hex.is_empty());
    }

    #[test]
    fn test_key_identity_serializes_to_json() {
        let k = VardhanKeystore::generate();
        let id = k.ed25519_identity();
        let json = serde_json::to_string(id).unwrap();
        assert!(json.contains(&id.key_id));
        let deser: KeyIdentity = serde_json::from_str(&json).unwrap();
        assert_eq!(id.key_id, deser.key_id);
    }

    #[test]
    fn test_key_version_starts_at_one() {
        let k = VardhanKeystore::generate();
        assert_eq!(k.ed25519_identity().key_version, 1);
        assert_eq!(k.mldsa87_identity().key_version, 1);
    }
}
