use crate::ProxyError;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use rand::RngCore;

pub fn aes_gcm_seal(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, ProxyError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce_bytes = [0u8; 12];
    use rand::RngCore;
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| ProxyError::CryptoError)?;
    let mut out = nonce_bytes.to_vec();
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn aes_gcm_open(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, ProxyError> {
    if data.len() < 12 {
        return Err(ProxyError::CryptoError);
    }
    let (nonce_bytes, ct) = data.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ct)
        .map_err(|_| ProxyError::CryptoError)
}
