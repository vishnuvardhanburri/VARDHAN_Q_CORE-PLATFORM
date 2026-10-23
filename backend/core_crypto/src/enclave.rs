//! Vardhan Q-Core — Hybrid Hardware/Software Enclave Interface
//! Device discovery only. Execution fails closed until an attested backend exists.

use std::path::Path;

#[derive(Debug)]
pub enum EnclaveType {
    AwsNitro,
    Tpm20,
    SoftwareSimulated,
}

/// Detects the highest level of hardware isolation available on the host machine.
pub fn detect_hardware_enclave() -> EnclaveType {
    if Path::new("/dev/nitro_enclaves").exists() {
        // AWS Nitro Enclaves detected (Production Cloud)
        EnclaveType::AwsNitro
    } else if Path::new("/dev/tpmrm0").exists() || Path::new("/dev/tpm0").exists() {
        // Physical TPM 2.0 Chip detected (On-Premises Hardware)
        EnclaveType::Tpm20
    } else {
        // Fallback to our existing mathematical Chaos Twin
        EnclaveType::SoftwareSimulated
    }
}

/// No reviewed enclave executor is implemented. Device presence is not attestation.
pub fn execute_secure_payload(_payload: &[u8]) -> Result<Vec<u8>, &'static str> {
    Err("Secure enclave execution is unavailable: no attested executor configured")
}

#[cfg(test)]
mod tests {
    #[test]
    fn regression_unimplemented_enclave_does_not_report_success() {
        assert!(super::execute_secure_payload(b"synthetic").is_err());
    }
}
