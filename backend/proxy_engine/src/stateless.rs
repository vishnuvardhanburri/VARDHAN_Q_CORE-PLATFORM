use crate::ProxyError;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::RngCore;

pub fn aes_gcm_seal(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, ProxyError> {
    let cipher = Aes256Gcm::new(key.into());
    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from(nonce_bytes);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
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
    let cipher = Aes256Gcm::new(key.into());
    let nonce_arr: [u8; 12] = nonce_bytes
        .try_into()
        .map_err(|_| ProxyError::CryptoError)?;
    let nonce = Nonce::from(nonce_arr);
    cipher
        .decrypt(&nonce, ct)
        .map_err(|_| ProxyError::CryptoError)
}
