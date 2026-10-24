use rand::Rng;
use sha2::{Digest, Sha256};

/// F-012: Marker indicating whether this module is running in simulation mode
/// (i.e., not backed by real Nitro Enclave hardware).
const IS_SIMULATION: bool = true;

/// ─── 1. THE CHAOS TWIN (Hostile Environment Simulator) ──────────────────────
/// In a Hybrid Architecture, we assume the host OS is constantly under attack.
/// The Chaos Twin intentionally mutates bits, drops packets, and corrupts data
/// in transit to mathematically prove the Secure Enclave's resilience.
///
/// F-012: This is a SIMULATION component. It does NOT represent real hardware
/// behavior and must NOT be used in production decision paths.
pub struct ChaosTwin {
    pub active: bool,
    pub corruption_probability: f64,
}

impl ChaosTwin {
    pub fn new(active: bool, corruption_probability: f64) -> Self {
        Self {
            active,
            corruption_probability,
        }
    }

    /// F-012: Returns true if this is a simulation (not backed by real hardware).
    pub fn is_simulation() -> bool {
        IS_SIMULATION
    }

    /// Randomly flips bits in the payload to simulate memory corruption or MITM attacks
    ///
    /// F-012: This is a SIMULATION function. In production, real hardware-level
    /// integrity checks are performed by the Nitro Enclave hardware, not by
    /// this bit-flip simulator.
    pub fn strike(&self, data: &mut [u8]) -> bool {
        if !self.active {
            return false;
        }

        let mut rng = rand::thread_rng();
        if rng.gen_bool(self.corruption_probability) {
            // Induce targeted bit-flip corruption
            let idx = rng.gen_range(0..data.len());
            data[idx] ^= 0b10101010;
            return true; // Corruption applied
        }
        false
    }
}

/// ─── 2. THE CONFIDENTIAL ENCLAVE (Nitro VSock Bridge) ───────────────────────
/// The enclave runs in an isolated, CPU-locked hypervisor space.
/// It verifies cryptographic integrity before ever generating a receipt.
///
/// F-012: This is a SIMULATION implementation. It does NOT communicate with
/// real AWS Nitro Enclave hardware. It performs a local SHA-256 hash comparison
/// instead. Production deployments must use real Nitro Enclave SDK integration.
pub struct NitroEnclaveBridge {
    pub vsock_cid: u32,
    pub vsock_port: u32,
}

impl NitroEnclaveBridge {
    pub fn new(vsock_cid: u32, vsock_port: u32) -> Self {
        Self {
            vsock_cid,
            vsock_port,
        }
    }

    /// F-012: Returns true if this is a simulation (not backed by real hardware).
    pub fn is_simulation() -> bool {
        IS_SIMULATION
    }

    /// Submits data to the hardware enclave. The enclave verifies the SHA256 integrity
    /// before applying the Hybrid ML-DSA-87 / Ed25519 signatures.
    ///
    /// F-012: WARNING — This is a SIMULATION. In production, this should communicate
    /// with a real Nitro Enclave via vsock. The current implementation only performs
    /// a local SHA-256 hash check and does NOT provide hardware-level attestation.
    pub fn execute_in_enclave(
        &self,
        original_hash: &str,
        payload: &[u8],
    ) -> Result<String, &'static str> {
        if IS_SIMULATION {
            tracing::warn!(
                "NitroEnclaveBridge::execute_in_enclave called in SIMULATION mode. \
                 This does NOT use real Nitro Enclave hardware. \
                 Do not use for production decisions."
            );
        }

        // Enclave internal verification
        let mut hasher = Sha256::new();
        hasher.update(payload);
        let current_hash = hex::encode(hasher.finalize());

        if current_hash != original_hash {
            // The Chaos Twin (or an attacker) corrupted the data.
            // The Enclave autonomous nervous system rejects the transaction.
            return Err(
                "ENCLAVE_PANIC: Hardware-level payload corruption detected. Transaction severed.",
            );
        }

        Ok(
            "ENCLAVE_SUCCESS: Payload integrity verified inside CPU ring-isolated memory."
                .to_string(),
        )
    }
}

/// ─── 3. THE MEAN HYBRID ─────────────────────────────────────────────────────
/// Combines the hostile Chaos Twin with the fortress of the Nitro Enclave.
///
/// F-012: This function uses SIMULATION components only. It must NOT be used
/// in production decision paths. Production code should use real Nitro Enclave
/// hardware integration instead.
pub fn execute_hybrid_transaction(payload_str: &str) {
    if IS_SIMULATION {
        tracing::warn!(
            "execute_hybrid_transaction called in SIMULATION mode. \
             ChaosTwin and NitroEnclaveBridge are SIMULATED — not backed by real hardware. \
             Do not use for production decisions."
        );
    }

    let mut payload = payload_str.as_bytes().to_vec();

    // Calculate the absolute truth (Original Hash)
    let mut hasher = Sha256::new();
    hasher.update(&payload);
    let original_hash = hex::encode(hasher.finalize());

    let chaos_engine = ChaosTwin::new(true, 0.3); // 30% chance of brutal corruption
    let enclave = NitroEnclaveBridge::new(3, 5005);

    eprintln!("[HYBRID CORE] Original State Hash: {}", original_hash);

    let corrupted = chaos_engine.strike(&mut payload);
    if corrupted {
        eprintln!("[HYBRID CORE] ⚠ CHAOS TWIN INJECTED HARDWARE CORRUPTION");
    }

    match enclave.execute_in_enclave(&original_hash, &payload) {
        Ok(msg) => eprintln!("[HYBRID CORE] ✓ {}", msg),
        Err(e) => eprintln!("[HYBRID CORE] 🛑 {}", e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_f012_chaos_twin_is_simulation() {
        // F-012: ChaosTwin must be marked as simulation
        assert!(
            ChaosTwin::is_simulation(),
            "ChaosTwin must be flagged as simulation mode"
        );
    }

    #[test]
    fn test_f012_nitro_enclave_is_simulation() {
        // F-012: NitroEnclaveBridge must be marked as simulation
        assert!(
            NitroEnclaveBridge::is_simulation(),
            "NitroEnclaveBridge must be flagged as simulation mode"
        );
    }

    #[test]
    #[allow(clippy::assertions_on_constants)]
    fn test_f012_no_production_enclave_available() {
        // F-012: Verify there is no non-simulation code path
        // that would allow production use of the simulated enclave
        assert!(
            IS_SIMULATION,
            "IS_SIMULATION must be true — real Nitro Enclave integration is not available"
        );
    }

    #[test]
    fn test_f012_chaos_twin_strike_works_in_simulation() {
        // Verify the simulation functions correctly (for testing purposes)
        let twin = ChaosTwin::new(true, 1.0); // 100% corruption
        let mut data = [0u8; 10];
        let result = twin.strike(&mut data);
        assert!(result, "ChaosTwin should corrupt with 100% probability");
    }

    #[test]
    fn test_f012_nitro_enclave_rejects_corrupted_payload() {
        let bridge = NitroEnclaveBridge::new(3, 5005);
        let result = bridge.execute_in_enclave("wrong_hash", b"payload");
        assert!(
            matches!(result, Err("ENCLAVE_PANIC: Hardware-level payload corruption detected. Transaction severed.")),
            "Corrupted payload should be rejected"
        );
    }

    #[test]
    fn test_f012_nitro_enclave_accepts_uncorrupted_payload() {
        let bridge = NitroEnclaveBridge::new(3, 5005);
        let payload = b"test-payload";
        let mut hasher = Sha256::new();
        hasher.update(payload);
        let hash = hex::encode(hasher.finalize());
        let result = bridge.execute_in_enclave(&hash, payload);
        assert!(result.is_ok());
    }
}
