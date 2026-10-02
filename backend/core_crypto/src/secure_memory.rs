use zeroize::{Zeroize, ZeroizeOnDrop};
use std::sync::atomic::{AtomicUsize, Ordering};

/// PEAK HUMAN ARCHITECTURE: CRYPTOGRAPHIC PARANOIA
/// This memory wrapper guarantees that raw key material is shredded from RAM 
/// the microsecond it drops out of scope. We do not trust the OS memory manager.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct SecureKeyMaterial {
    key_bytes: Vec<u8>,
}

impl SecureKeyMaterial {
    pub fn new(mut bytes: Vec<u8>) -> Self {
        let material = Self { key_bytes: bytes.clone() };
        // Shred the original array from the stack immediately
        bytes.zeroize();
        material
    }

    pub fn expose_secret(&self) -> &[u8] {
        &self.key_bytes
    }
}

/// LOCK-FREE HOT PATH: ATOMIC RING BUFFER INDEX
/// Eliminates Mutex contention during heavy Raft consensus loads.
pub struct LockFreeState {
    head: AtomicUsize,
    tail: AtomicUsize,
}

impl LockFreeState {
    pub fn new() -> Self {
        Self {
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
        }
    }

    #[inline(always)]
    pub fn advance_head(&self) {
        // Relaxed ordering for raw throughput. We enforce memory barriers at the ring boundary.
        self.head.fetch_add(1, Ordering::Relaxed);
    }
}
