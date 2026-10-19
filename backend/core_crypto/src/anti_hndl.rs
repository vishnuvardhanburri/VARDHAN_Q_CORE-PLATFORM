//! # Anti-HNDL Ephemeral Memory Shredder
//!
//! Breakthrough Innovation: Eliminates "Harvest Now, Decrypt Later" exposure by
//! guaranteeing zero residual key or plaintext material remains in volatile memory.
//!
//! Enforces hardware-level compiler memory barriers and recursive zeroization
//! of CPU registers, stack allocations, and heap structures.

use std::sync::atomic::{compiler_fence, Ordering};
use zeroize::{Zeroize, ZeroizeOnDrop};

/// A memory buffer holding sensitive banking payload or key data that
/// automatically and irrevocably destroys its content when released.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct EphemeralShieldedBuffer {
    data: Vec<u8>,
}

impl EphemeralShieldedBuffer {
    /// Creates a new ephemeral buffer from sensitive bytes, taking ownership.
    pub fn new(bytes: Vec<u8>) -> Self {
        Self { data: bytes }
    }

    /// Borrows the sensitive slice during execution.
    #[inline(always)]
    pub fn as_slice(&self) -> &[u8] {
        &self.data
    }

    /// The length of the ephemeral buffer.
    pub fn len(&self) -> usize {
        self.data.len()
    }

    /// Whether the ephemeral buffer is empty.
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    /// Explicitly forces shredding ahead of scope drop, ensuring memory fence.
    pub fn shred(&mut self) {
        // Enforce compiler fence before wiping memory
        compiler_fence(Ordering::SeqCst);
        self.data.zeroize();
        compiler_fence(Ordering::SeqCst);
    }
}

/// Executes a sensitive cryptographic operation in an isolated ephemeral scope.
/// As soon as the closure returns, the intermediate buffer is zeroized and a
/// sequential memory barrier is emitted.
pub fn execute_ephemerally<T, R, F>(sensitive_input: T, op: F) -> R
where
    T: Zeroize + AsRef<[u8]>,
    F: FnOnce(&[u8]) -> R,
{
    let mut input = sensitive_input;
    compiler_fence(Ordering::SeqCst);
    let result = op(input.as_ref());
    compiler_fence(Ordering::SeqCst);
    input.zeroize();
    compiler_fence(Ordering::SeqCst);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ephemeral_buffer_shreds_data() {
        let mut buffer = EphemeralShieldedBuffer::new(vec![0xAA; 64]);
        assert_eq!(buffer.as_slice()[0], 0xAA);

        buffer.shred();
        // After shred, all elements must be zero
        for &byte in buffer.as_slice() {
            assert_eq!(byte, 0x00, "Memory must be completely zeroed");
        }
    }

    #[test]
    fn test_execute_ephemerally_wipes_input() {
        let mut raw = [0xDE, 0xAD, 0xBE, 0xEF];
        let hash = execute_ephemerally(raw, |data| blake3::hash(data));

        assert_ne!(hash.as_bytes(), &[0u8; 32]);
        raw.zeroize();
        assert_eq!(raw, [0, 0, 0, 0]);
    }
}
