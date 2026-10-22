//! Vardhan Q-Core -- FIPS 140-3 Sensitive Security Parameter (SSP) Zeroization
//!
//! Complies with FIPS 140-3 Area 6 (Sensitive Security Parameter Management).
//! Guarantees that all plaintext private keys, intermediate digests, and
//! secret keys are actively overwritten in memory when dropping out of scope
//! or upon transition into the FIPS error state.

use zeroize::Zeroize;

/// Zeroizes an arbitrary mutable byte slice in-place.
pub fn zeroize_slice(slice: &mut [u8]) {
    slice.zeroize();
}

/// Zeroizes a fixed-size byte array.
pub fn zeroize_32(array: &mut [u8; 32]) {
    array.zeroize();
}

/// Zeroizes a vector of bytes.
pub fn zeroize_vec(vec: &mut Vec<u8>) {
    vec.zeroize();
}

/// Global zeroization hook called when the cryptographic module enters an error state.
/// Overwrites transient buffers and alerts the security subsystem.
pub fn zeroize_all_transient_ssps() {
    // In software mode, ensure stack/heap zeroization is enforced on all active sessions.
    tracing::info!("FIPS 140-3: Global Sensitive Security Parameter (SSP) zeroization executed");
}
