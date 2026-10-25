//! VARDHAN Q-CORE — PQC Interoperability Binary Runner
//!
//! Exposes raw NIST FIPS 203 (ML-KEM-1024) and FIPS 204 (ML-DSA-87) primitives
//! over a versioned, length-delimited binary protocol on stdin/stdout.
//! Stateful process memory retains decapsulation and signing keys for the session.

use fips204::ml_dsa_87;
use fips204::traits::{SerDes, Signer, Verifier};
use ml_kem::kem::{Decapsulate, Encapsulate};
use ml_kem::{Ciphertext, EncodedSizeUser, KemCore, MlKem1024};
use rand::rngs::OsRng;
use std::io::{self, Read, Write};

const PROTOCOL_MAGIC: [u8; 2] = [0x51, 0x43]; // "QC"
const PROTOCOL_VERSION: u8 = 0x01;

// Command identifiers
const CMD_KEM_GENERATE_KEYPAIR: u8 = 0x01;
const CMD_KEM_DECAPSULATE: u8 = 0x02;
const CMD_KEM_ENCAPSULATE: u8 = 0x03;
const CMD_DSA_GENERATE_KEYPAIR: u8 = 0x04;
const CMD_DSA_SIGN: u8 = 0x05;
const CMD_DSA_VERIFY: u8 = 0x06;
const CMD_RESET_STATE: u8 = 0x07;
const CMD_TERMINATE: u8 = 0xFF;

// Status codes
const STATUS_SUCCESS: u8 = 0x00;
const STATUS_ERROR_UNSUPPORTED_VERSION: u8 = 0x01;
const STATUS_ERROR_INVALID_COMMAND: u8 = 0x02;
const STATUS_ERROR_INVALID_LENGTH: u8 = 0x03;
const STATUS_ERROR_CRYPTO_FAILURE: u8 = 0x04;
const STATUS_ERROR_NO_RETAINED_KEY: u8 = 0x05;

// Exact NIST primitive lengths
const ML_KEM_1024_ENCAP_KEY_LEN: usize = 1568;
const ML_KEM_1024_CIPHERTEXT_LEN: usize = 1568;
const ML_KEM_1024_SHARED_KEY_LEN: usize = 32;

const ML_DSA_87_PUBLIC_KEY_LEN: usize = ml_dsa_87::PK_LEN; // 2592
const ML_DSA_87_SIG_LEN: usize = ml_dsa_87::SIG_LEN; // 4627

const MAX_PAYLOAD_SIZE: usize = 10 * 1024 * 1024; // 10MB safety bound

struct RunnerState {
    retained_kem_decap: Option<<MlKem1024 as KemCore>::DecapsulationKey>,
    retained_dsa_sk: Option<ml_dsa_87::PrivateKey>,
}

impl RunnerState {
    fn new() -> Self {
        Self {
            retained_kem_decap: None,
            retained_dsa_sk: None,
        }
    }

    fn reset(&mut self) {
        // Drop and release retained keys from process memory
        let _ = self.retained_kem_decap.take();
        let _ = self.retained_dsa_sk.take();
    }
}

fn send_response(stdout: &mut io::Stdout, status: u8, payload: &[u8]) -> io::Result<()> {
    stdout.write_all(&PROTOCOL_MAGIC)?;
    stdout.write_all(&[status])?;
    let len = payload.len() as u32;
    stdout.write_all(&len.to_be_bytes())?;
    if !payload.is_empty() {
        stdout.write_all(payload)?;
    }
    stdout.flush()
}

fn read_exact_or_eof(stdin: &mut io::Stdin, buf: &mut [u8]) -> io::Result<bool> {
    let mut total = 0;
    while total < buf.len() {
        let n = stdin.read(&mut buf[total..])?;
        if n == 0 {
            if total == 0 {
                return Ok(false);
            } else {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "Unexpected EOF reading binary frame",
                ));
            }
        }
        total += n;
    }
    Ok(true)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut state = RunnerState::new();

    eprintln!(
        "[interop_runner] Initialized stateful PQC interop runner (v{})",
        PROTOCOL_VERSION
    );

    loop {
        // Read header: Magic (2) + Version (1) + Command (1) + Payload Length (4) = 8 bytes
        let mut header = [0u8; 8];
        if !read_exact_or_eof(&mut stdin, &mut header)? {
            eprintln!("[interop_runner] Clean client disconnect (EOF)");
            break;
        }

        if header[0..2] != PROTOCOL_MAGIC {
            eprintln!("[interop_runner] Invalid magic bytes: {:?}", &header[0..2]);
            send_response(&mut stdout, STATUS_ERROR_INVALID_COMMAND, b"Invalid magic")?;
            continue;
        }

        let version = header[2];
        if version != PROTOCOL_VERSION {
            eprintln!("[interop_runner] Unsupported protocol version: {}", version);
            send_response(
                &mut stdout,
                STATUS_ERROR_UNSUPPORTED_VERSION,
                b"Unsupported version",
            )?;
            continue;
        }

        let cmd = header[3];
        let payload_len = u32::from_be_bytes([header[4], header[5], header[6], header[7]]) as usize;

        if payload_len > MAX_PAYLOAD_SIZE {
            eprintln!(
                "[interop_runner] Payload size exceeds maximum bound: {}",
                payload_len
            );
            send_response(
                &mut stdout,
                STATUS_ERROR_INVALID_LENGTH,
                b"Payload too large",
            )?;
            continue;
        }

        let mut payload = vec![0u8; payload_len];
        if payload_len > 0 {
            stdin.read_exact(&mut payload)?;
        }

        match cmd {
            CMD_KEM_GENERATE_KEYPAIR => {
                if payload_len != 0 {
                    send_response(
                        &mut stdout,
                        STATUS_ERROR_INVALID_LENGTH,
                        b"Expected empty payload",
                    )?;
                    continue;
                }
                let (decap_key, encap_key) = MlKem1024::generate(&mut OsRng);
                state.retained_kem_decap = Some(decap_key);
                let ek_bytes = encap_key.as_bytes().to_vec();
                assert_eq!(ek_bytes.len(), ML_KEM_1024_ENCAP_KEY_LEN);
                send_response(&mut stdout, STATUS_SUCCESS, &ek_bytes)?;
            }

            CMD_KEM_DECAPSULATE => {
                if payload_len != ML_KEM_1024_CIPHERTEXT_LEN {
                    send_response(
                        &mut stdout,
                        STATUS_ERROR_INVALID_LENGTH,
                        format!(
                            "Expected ciphertext length {}, got {}",
                            ML_KEM_1024_CIPHERTEXT_LEN, payload_len
                        )
                        .as_bytes(),
                    )?;
                    continue;
                }

                let decap = match state.retained_kem_decap.as_ref() {
                    Some(dk) => dk,
                    None => {
                        send_response(
                            &mut stdout,
                            STATUS_ERROR_NO_RETAINED_KEY,
                            b"No retained KEM key",
                        )?;
                        continue;
                    }
                };

                let ct_arr: [u8; ML_KEM_1024_CIPHERTEXT_LEN] = match payload.as_slice().try_into() {
                    Ok(arr) => arr,
                    Err(_) => {
                        send_response(&mut stdout, STATUS_ERROR_INVALID_LENGTH, b"Bad CT slice")?;
                        continue;
                    }
                };

                let ct: Ciphertext<MlKem1024> = ct_arr.into();
                // In ML-KEM, decapsulation of a valid or invalid ciphertext succeeds deterministically
                // via implicit rejection (deriving pseudorandom key on failure).
                match decap.decapsulate(&ct) {
                    Ok(ss) => {
                        assert_eq!(ss.len(), ML_KEM_1024_SHARED_KEY_LEN);
                        send_response(&mut stdout, STATUS_SUCCESS, ss.as_slice())?;
                    }
                    Err(_) => {
                        send_response(
                            &mut stdout,
                            STATUS_ERROR_CRYPTO_FAILURE,
                            b"Decapsulation failed",
                        )?;
                    }
                }
            }

            CMD_KEM_ENCAPSULATE => {
                if payload_len != ML_KEM_1024_ENCAP_KEY_LEN {
                    send_response(
                        &mut stdout,
                        STATUS_ERROR_INVALID_LENGTH,
                        format!(
                            "Expected encap key length {}, got {}",
                            ML_KEM_1024_ENCAP_KEY_LEN, payload_len
                        )
                        .as_bytes(),
                    )?;
                    continue;
                }

                let ek_arr: [u8; ML_KEM_1024_ENCAP_KEY_LEN] = match payload.as_slice().try_into() {
                    Ok(arr) => arr,
                    Err(_) => {
                        send_response(&mut stdout, STATUS_ERROR_INVALID_LENGTH, b"Bad PK slice")?;
                        continue;
                    }
                };

                let ek_encoded =
                    ml_kem::Encoded::<<MlKem1024 as KemCore>::EncapsulationKey>::from(ek_arr);
                let ek = <MlKem1024 as KemCore>::EncapsulationKey::from_bytes(&ek_encoded);
                let (ct, ss) = match ek.encapsulate(&mut OsRng) {
                    Ok(pair) => pair,
                    Err(_) => {
                        send_response(
                            &mut stdout,
                            STATUS_ERROR_CRYPTO_FAILURE,
                            b"Encapsulation failed",
                        )?;
                        continue;
                    }
                };

                let mut out =
                    Vec::with_capacity(ML_KEM_1024_CIPHERTEXT_LEN + ML_KEM_1024_SHARED_KEY_LEN);
                out.extend_from_slice(ct.as_slice());
                out.extend_from_slice(ss.as_slice());
                send_response(&mut stdout, STATUS_SUCCESS, &out)?;
            }

            CMD_DSA_GENERATE_KEYPAIR => {
                if payload_len != 0 {
                    send_response(
                        &mut stdout,
                        STATUS_ERROR_INVALID_LENGTH,
                        b"Expected empty payload",
                    )?;
                    continue;
                }
                match ml_dsa_87::try_keygen() {
                    Ok((pk, sk)) => {
                        state.retained_dsa_sk = Some(sk);
                        let pk_bytes: [u8; ML_DSA_87_PUBLIC_KEY_LEN] = pk.into_bytes();
                        send_response(&mut stdout, STATUS_SUCCESS, &pk_bytes)?;
                    }
                    Err(e) => {
                        send_response(
                            &mut stdout,
                            STATUS_ERROR_CRYPTO_FAILURE,
                            format!("Keygen failed: {e}").as_bytes(),
                        )?;
                    }
                }
            }

            CMD_DSA_SIGN => {
                let sk = match state.retained_dsa_sk.as_ref() {
                    Some(k) => k,
                    None => {
                        send_response(
                            &mut stdout,
                            STATUS_ERROR_NO_RETAINED_KEY,
                            b"No retained DSA key",
                        )?;
                        continue;
                    }
                };

                match sk.try_sign(&payload, &[]) {
                    Ok(sig) => {
                        assert_eq!(sig.len(), ML_DSA_87_SIG_LEN);
                        send_response(&mut stdout, STATUS_SUCCESS, &sig)?;
                    }
                    Err(e) => {
                        send_response(
                            &mut stdout,
                            STATUS_ERROR_CRYPTO_FAILURE,
                            format!("Signing failed: {e}").as_bytes(),
                        )?;
                    }
                }
            }

            CMD_DSA_VERIFY => {
                // Layout: pk_len(4B) | pk | sig_len(4B) | sig | msg_len(4B) | msg
                if payload.len() < 12 {
                    send_response(
                        &mut stdout,
                        STATUS_ERROR_INVALID_LENGTH,
                        b"Payload too short for verify",
                    )?;
                    continue;
                }

                let mut cursor = 0;
                let pk_len =
                    u32::from_be_bytes(payload[cursor..cursor + 4].try_into().unwrap()) as usize;
                cursor += 4;
                if cursor + pk_len > payload.len() || pk_len != ML_DSA_87_PUBLIC_KEY_LEN {
                    send_response(&mut stdout, STATUS_ERROR_INVALID_LENGTH, b"Invalid pk_len")?;
                    continue;
                }
                let pk_bytes: [u8; ML_DSA_87_PUBLIC_KEY_LEN] =
                    payload[cursor..cursor + pk_len].try_into().unwrap();
                cursor += pk_len;

                if cursor + 4 > payload.len() {
                    send_response(
                        &mut stdout,
                        STATUS_ERROR_INVALID_LENGTH,
                        b"Truncated at sig_len",
                    )?;
                    continue;
                }
                let sig_len =
                    u32::from_be_bytes(payload[cursor..cursor + 4].try_into().unwrap()) as usize;
                cursor += 4;
                if cursor + sig_len > payload.len() || sig_len != ML_DSA_87_SIG_LEN {
                    send_response(&mut stdout, STATUS_ERROR_INVALID_LENGTH, b"Invalid sig_len")?;
                    continue;
                }
                let sig_bytes: [u8; ML_DSA_87_SIG_LEN] =
                    payload[cursor..cursor + sig_len].try_into().unwrap();
                cursor += sig_len;

                if cursor + 4 > payload.len() {
                    send_response(
                        &mut stdout,
                        STATUS_ERROR_INVALID_LENGTH,
                        b"Truncated at msg_len",
                    )?;
                    continue;
                }
                let msg_len =
                    u32::from_be_bytes(payload[cursor..cursor + 4].try_into().unwrap()) as usize;
                cursor += 4;
                if cursor + msg_len != payload.len() {
                    send_response(
                        &mut stdout,
                        STATUS_ERROR_INVALID_LENGTH,
                        b"Mismatched msg_len",
                    )?;
                    continue;
                }
                let msg = &payload[cursor..cursor + msg_len];

                let pk = match ml_dsa_87::PublicKey::try_from_bytes(pk_bytes) {
                    Ok(k) => k,
                    Err(_) => {
                        // Malformed public key returns verification failure
                        send_response(&mut stdout, STATUS_SUCCESS, &[0x00])?;
                        continue;
                    }
                };

                let is_valid = pk.verify(msg, &sig_bytes, &[]);
                let res_byte = if is_valid { 0x01 } else { 0x00 };
                send_response(&mut stdout, STATUS_SUCCESS, &[res_byte])?;
            }

            CMD_RESET_STATE => {
                state.reset();
                eprintln!("[interop_runner] Retained keys dropped from process memory");
                send_response(&mut stdout, STATUS_SUCCESS, &[])?;
            }

            CMD_TERMINATE => {
                state.reset();
                send_response(&mut stdout, STATUS_SUCCESS, &[])?;
                eprintln!("[interop_runner] Clean termination requested");
                break;
            }

            _ => {
                eprintln!("[interop_runner] Unknown command: 0x{:02x}", cmd);
                send_response(
                    &mut stdout,
                    STATUS_ERROR_INVALID_COMMAND,
                    b"Unknown command",
                )?;
            }
        }
    }

    Ok(())
}
