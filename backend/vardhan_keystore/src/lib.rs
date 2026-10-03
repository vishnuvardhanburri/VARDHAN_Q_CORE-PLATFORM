use ed25519_dalek::{Signer, SigningKey};
use pqcrypto_mldsa::mldsa87::{
    PublicKey as MlDsaPublicKey, SecretKey, detached_sign as mldsa_sign, keypair as mldsa_keypair,
    verify_detached_signature as mldsa_verify,
};
use pqcrypto_traits::sign::{
    DetachedSignature as PQDetachedSignature, PublicKey as PQPublicKey, SecretKey as PQSecretKey,
};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
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

#[derive(Serialize, Deserialize)]
struct StoredKeystoreMetadata {
    ed25519_identity: KeyIdentity,
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

    pub fn save_to_dir(&self, dir: &Path) -> io::Result<()> {
        fs::create_dir_all(dir)?;

        let write_secure = |filename: &str, data: &[u8]| -> io::Result<()> {
            let path = dir.join(filename);
            let tmp_path = dir.join(format!("{}.tmp", filename));

            let mut options = OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                options.mode(0o600); // Enforce restrictive permissions
            }
            let mut file = options.open(&tmp_path)?;
            file.write_all(data)?;
            file.sync_all()?; // Ensure durability before rename
            fs::rename(tmp_path, path)?; // Atomic persistence
            Ok(())
        };

        let meta = StoredKeystoreMetadata {
            ed25519_identity: self.ed25519_identity.clone(),
            mldsa87_identity: self.mldsa87_identity.clone(),
        };
        let meta_json = serde_json::to_string_pretty(&meta)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        write_secure("keystore_meta.json", meta_json.as_bytes())?;
        write_secure("ed25519.key", &self.ed25519_key.to_bytes())?;
        write_secure("mldsa87.sec", self.mldsa87_secret.as_bytes())?;
        write_secure("mldsa87.pub", self.mldsa87_public.as_bytes())?;

        Ok(())
    }

    pub fn load_from_dir(dir: &Path) -> io::Result<Self> {
        let meta_str = fs::read_to_string(dir.join("keystore_meta.json"))?;
        let meta: StoredKeystoreMetadata = serde_json::from_str(&meta_str)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        let ed_bytes = fs::read(dir.join("ed25519.key"))?;
        let ed_arr: [u8; 32] = ed_bytes
            .try_into()
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "Invalid ed25519 key size"))?;
        let ed25519_key = SigningKey::from_bytes(&ed_arr);
        let ed25519_pub = ed25519_key.verifying_key();

        // Verify metadata <-> actual public-key fingerprint consistency
        let loaded_ed25519_fingerprint =
            hex::encode(blake3::hash(ed25519_pub.as_bytes()).as_bytes());
        if loaded_ed25519_fingerprint != meta.ed25519_identity.public_key_fingerprint {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Corrupt Keystore: Ed25519 public key fingerprint mismatch",
            ));
        }

        let mldsa_sec_bytes = fs::read(dir.join("mldsa87.sec"))?;
        let mldsa87_secret = SecretKey::from_bytes(&mldsa_sec_bytes)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        let mldsa_pub_bytes = fs::read(dir.join("mldsa87.pub"))?;
        let mldsa87_public = MlDsaPublicKey::from_bytes(&mldsa_pub_bytes)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        // Verify metadata <-> actual public-key fingerprint consistency
        let loaded_mldsa87_fingerprint =
            hex::encode(blake3::hash(mldsa87_public.as_bytes()).as_bytes());
        if loaded_mldsa87_fingerprint != meta.mldsa87_identity.public_key_fingerprint {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Corrupt Keystore: ML-DSA-87 public key fingerprint mismatch",
            ));
        }

        // Verify private/public key consistency where technically possible
        let dummy_payload = b"consistency_check";
        let dummy_sig = mldsa_sign(dummy_payload, &mldsa87_secret);
        if mldsa_verify(&dummy_sig, dummy_payload, &mldsa87_public).is_err() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Corrupt Keystore: ML-DSA-87 private/public key mismatch",
            ));
        }

        Ok(Self {
            ed25519_key,
            ed25519_identity: meta.ed25519_identity,
            mldsa87_secret,
            mldsa87_public,
            mldsa87_identity: meta.mldsa87_identity,
        })
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

    pub fn ed25519_public_key(&self) -> ed25519_dalek::VerifyingKey {
        self.ed25519_key.verifying_key()
    }

    pub fn mldsa87_identity(&self) -> &KeyIdentity {
        &self.mldsa87_identity
    }

    pub fn mldsa87_public_key(&self) -> &MlDsaPublicKey {
        &self.mldsa87_public
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
        assert_eq!(
            res1.key_identity.public_key_fingerprint,
            res2.key_identity.public_key_fingerprint
        );
    }

    #[test]
    fn test_mldsa87_fingerprint_is_stable() {
        let k = VardhanKeystore::generate();
        let res1 = k.sign_mldsa87(b"hello");
        let res2 = k.sign_mldsa87(b"world");
        assert_eq!(
            res1.key_identity.public_key_fingerprint,
            res2.key_identity.public_key_fingerprint
        );
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

    #[test]
    fn test_persistence_preserves_identity_and_keys() {
        let dir = tempfile::tempdir().unwrap();
        let k1 = VardhanKeystore::generate();
        k1.save_to_dir(dir.path()).unwrap();

        let k2 = VardhanKeystore::load_from_dir(dir.path()).unwrap();

        assert_eq!(k1.ed25519_identity().key_id, k2.ed25519_identity().key_id);
        assert_eq!(k1.mldsa87_identity().key_id, k2.mldsa87_identity().key_id);

        let payload = b"test payload";
        let sig1 = k1.sign_ed25519(payload);
        let sig2 = k2.sign_ed25519(payload);
        assert_eq!(sig1.signature_hex, sig2.signature_hex);

        let mldsa_sig1 = k1.sign_mldsa87(payload);
        let mldsa_sig2 = k2.sign_mldsa87(payload);
        assert_eq!(
            mldsa_sig1.key_identity.key_id,
            mldsa_sig2.key_identity.key_id
        );
    }

    #[test]
    fn test_persistence_rejects_corrupted_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let k1 = VardhanKeystore::generate();
        k1.save_to_dir(dir.path()).unwrap();

        // Corrupt the metadata fingerprint
        let meta_path = dir.path().join("keystore_meta.json");
        let mut meta_str = fs::read_to_string(&meta_path).unwrap();
        meta_str = meta_str.replace(
            &k1.ed25519_identity().public_key_fingerprint,
            "corrupted_fingerprint_data",
        );
        fs::write(&meta_path, meta_str).unwrap();

        // Load should fail due to inconsistency
        let k2_result = VardhanKeystore::load_from_dir(dir.path());
        assert!(k2_result.is_err());
        if let Err(e) = k2_result {
            assert!(e.to_string().contains("fingerprint mismatch"));
        } else {
            panic!("expected error");
        }
    }
}
