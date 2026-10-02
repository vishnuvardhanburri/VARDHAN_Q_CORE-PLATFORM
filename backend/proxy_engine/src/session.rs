use crate::ProxyError;
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::{Zeroize, Zeroizing};

#[derive(Clone)]
pub struct SessionContext {
    pub session_id: [u8; 32],
    pub shared_secret: Zeroizing<Vec<u8>>,
    pub session_key: Zeroizing<[u8; 32]>,
    pub client_to_server_key: Zeroizing<[u8; 32]>,
    pub server_to_client_key: Zeroizing<[u8; 32]>,
    pub session_salt: [u8; 4],
    /// The authenticated peer's ML-DSA-87 public key bytes, as verified by
    /// signature checking during the PQ handshake. Callers MUST use this to
    /// cross-validate any claimed sender identity in application-layer envelopes.
    pub peer_dsa_pub_bytes: Vec<u8>,
}

pub fn derive_session_context(
    shared_secret: &[u8],
    transcript: &[u8],
    peer_dsa_pub_bytes: Vec<u8>,
) -> Result<SessionContext, ProxyError> {
    let hk = Hkdf::<Sha256>::new(Some(transcript), shared_secret);

    let mut okm = [0u8; 100]; // 32*3 + 4 = 100
    hk.expand(b"VARDHAN_QUANTUM_PROXY_SESSION_V2", &mut okm)
        .map_err(|_| ProxyError::CryptoError)?;

    let mut session_id = [0u8; 32];
    session_id.copy_from_slice(&okm[0..32]);

    let mut c_to_s = [0u8; 32];
    c_to_s.copy_from_slice(&okm[32..64]);

    let mut s_to_c = [0u8; 32];
    s_to_c.copy_from_slice(&okm[64..96]);

    let mut session_salt = [0u8; 4];
    session_salt.copy_from_slice(&okm[96..100]);

    let session_key = Zeroizing::new(c_to_s);
    okm.zeroize();

    Ok(SessionContext {
        session_id,
        shared_secret: Zeroizing::new(shared_secret.to_vec()),
        session_key,
        client_to_server_key: Zeroizing::new(c_to_s),
        server_to_client_key: Zeroizing::new(s_to_c),
        session_salt,
        peer_dsa_pub_bytes,
    })
}

pub fn derive_session_keys(
    shared_secret: &[u8],
    transcript: &[u8],
    peer_dsa_pub_bytes: Vec<u8>,
) -> Result<Zeroizing<[u8; 32]>, ProxyError> {
    let ctx = derive_session_context(shared_secret, transcript, peer_dsa_pub_bytes)?;
    Ok(ctx.session_key.clone())
}
