use crate::ProxyError;
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Key, Nonce,
};
use bytes::{Buf, BufMut, BytesMut};
use std::io;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use zeroize::Zeroize;

/// Maximum AEAD frame size. Raft AppendEntries messages carrying checkpoint
/// entries (ML-DSA-87 signatures ~4627 bytes + ledger Merkle data) can exceed
/// 64 KB. Bump to 256 KB to accommodate checkpoint-carrying AppendEntries.
const MAX_FRAME_SIZE: usize = 256 * 1024;

use std::sync::atomic::{AtomicU64, Ordering};

pub struct AeadTransport {
    is_initiator: bool,
    stream: TcpStream,
    tx_key: [u8; 32],
    rx_key: [u8; 32],
    session_id: [u8; 32],
    session_salt: [u8; 4],
    tx_seq: AtomicU64,
    rx_seq: AtomicU64,
    read_buf: BytesMut,
}

impl AeadTransport {
    pub fn new(
        stream: TcpStream,
        tx_key: [u8; 32],
        rx_key: [u8; 32],
        session_id: [u8; 32],
        session_salt: [u8; 4],
        is_initiator: bool,
    ) -> Self {
        Self {
            is_initiator,
            stream,
            tx_key,
            rx_key,
            session_id,
            session_salt,
            tx_seq: AtomicU64::new(0),
            rx_seq: AtomicU64::new(0),
            read_buf: BytesMut::with_capacity(MAX_FRAME_SIZE * 2),
        }
    }

    fn build_aad(&self, is_tx: bool, seq: u64, payload_len: u32) -> Vec<u8> {
        let mut aad = Vec::with_capacity(32 + 1 + 8 + 4 + 4);
        aad.extend_from_slice(&self.session_id); // 32 bytes session identifier

        let dir = if self.is_initiator {
            if is_tx {
                1u8
            } else {
                0u8
            }
        } else {
            if is_tx {
                0u8
            } else {
                1u8
            }
        };
        aad.push(dir); // 1 byte direction
        aad.extend_from_slice(&seq.to_be_bytes()); // 8 byte sequence number
        aad.extend_from_slice(b"V1.0"); // 4 byte protocol version
        aad.extend_from_slice(&payload_len.to_be_bytes()); // bind length
        aad
    }

    fn build_nonce(&self, seq: u64) -> [u8; 12] {
        let mut nonce = [0u8; 12];
        nonce[0..4].copy_from_slice(&self.session_salt);
        nonce[4..12].copy_from_slice(&seq.to_be_bytes());
        nonce
    }

    pub async fn write_frame(&mut self, data: &[u8]) -> Result<(), ProxyError> {
        if data.len() > MAX_FRAME_SIZE {
            return Err(ProxyError::FrameTooLarge(data.len()));
        }

        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.tx_key));
        let seq = self.tx_seq.fetch_add(1, Ordering::SeqCst);
        let nonce_bytes = self.build_nonce(seq);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let aad = self.build_aad(true, seq, data.len() as u32);

        let payload = Payload {
            msg: data,
            aad: &aad,
        };

        let ciphertext = cipher
            .encrypt(nonce, payload)
            .map_err(|_| ProxyError::CryptoError)?;

        let mut header = [0u8; 4];
        header.copy_from_slice(&(ciphertext.len() as u32).to_be_bytes());

        self.stream.write_all(&header).await?;
        self.stream.write_all(&ciphertext).await?;

        if seq >= u64::MAX {
            return Err(ProxyError::NonceExhaustion);
        }
        Ok(())
    }

    pub async fn read_frame(&mut self) -> Result<Option<Vec<u8>>, ProxyError> {
        loop {
            if self.read_buf.len() >= 4 {
                let mut len_bytes = [0u8; 4];
                len_bytes.copy_from_slice(&self.read_buf[..4]);
                let frame_len = u32::from_be_bytes(len_bytes) as usize;

                if frame_len > MAX_FRAME_SIZE + 16 {
                    // Account for GCM tag
                    return Err(ProxyError::FrameTooLarge(frame_len));
                }

                if self.read_buf.len() >= 4 + frame_len {
                    self.read_buf.advance(4);
                    let ciphertext = self.read_buf.split_to(frame_len).to_vec();

                    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.rx_key));
                    let seq = self.rx_seq.load(Ordering::SeqCst);
                    let nonce_bytes = self.build_nonce(seq);
                    let nonce = Nonce::from_slice(&nonce_bytes);
                    let expected_pt_len = (frame_len.saturating_sub(16)) as u32;
                    let aad = self.build_aad(false, seq, expected_pt_len);

                    let payload = Payload {
                        msg: &ciphertext,
                        aad: &aad,
                    };

                    let plaintext = cipher
                        .decrypt(nonce, payload)
                        .map_err(|_| ProxyError::CryptoError)?;

                    self.rx_seq.fetch_add(1, Ordering::SeqCst);
                    if seq >= u64::MAX {
                        return Err(ProxyError::NonceExhaustion);
                    }
                    return Ok(Some(plaintext));
                }
            }

            let mut chunk = [0u8; 8192];
            match self.stream.read(&mut chunk).await {
                Ok(0) => {
                    if self.read_buf.is_empty() {
                        return Ok(None);
                    } else {
                        return Err(ProxyError::Io(io::Error::new(
                            io::ErrorKind::UnexpectedEof,
                            "Incomplete AEAD frame",
                        )));
                    }
                }
                Ok(n) => {
                    self.read_buf.extend_from_slice(&chunk[..n]);
                }
                Err(e) => return Err(ProxyError::Io(e)),
            }
        }
    }
}
