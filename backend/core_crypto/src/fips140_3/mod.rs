//! Vardhan Q-Core -- FIPS 140-3 Cryptographic Module Architecture
//!
//! Provides compliance with FIPS 140-3 (ISO/IEC 19790:2021) for cryptographic
//! modules:
//! - Pre-operational Known Answer Tests (KAT) for all approved algorithms
//! - Conditional Pairwise Consistency Tests (PCT) on key generation
//! - Continuous Random Number Generator Tests (CRNGT / SP 800-90B)
//! - Sensitive Security Parameter (SSP) zeroization
//! - Fail-closed error state inhibiting cryptographic services on fault

pub mod kat;
pub mod self_test;
pub mod zeroize_ssp;

pub use kat::{
    run_aes_256_gcm_kat, run_blake3_kat, run_ed25519_kat, run_ml_dsa_87_kat, run_ml_kem_1024_kat,
    run_module_integrity_kat, run_sha3_512_kat, KatFailure,
};
pub use self_test::{
    assert_fips_operational, get_fips_module_state, run_entropy_health_test,
    run_pairwise_consistency_test_dsa, run_pairwise_consistency_test_kem, run_power_on_self_tests,
    FipsError, FipsFailureDetail, FipsModuleState, FipsVerificationSummary, TestVerdict,
};
pub use zeroize_ssp::{zeroize_all_transient_ssps, zeroize_slice};

use serde::{Deserialize, Serialize};
use std::env;

/// Complete FIPS 140-3 operational report suitable for audit telemetry and API response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FipsStatusReport {
    pub status: String,
    pub fips_140_3_mode: bool,
    pub security_level: String,
    pub self_tests: Option<FipsVerificationSummary>,
    pub failure_detail: Option<FipsFailureDetail>,
    pub approved_algorithms: Vec<String>,
}

/// Checks if FIPS 140-3 mode is explicitly requested or required by environment.
pub fn is_fips_mode_enforced() -> bool {
    env::var("VARDHAN_FIPS_MODE")
        .map(|v| v == "true" || v == "1")
        .unwrap_or_else(|_| env::var("VARDHAN_ENV").unwrap_or_default() == "production")
}

/// Generates an authoritative status report of the cryptographic module.
pub fn get_fips_status_report() -> FipsStatusReport {
    let state = get_fips_module_state();
    let enforced = is_fips_mode_enforced();

    match state {
        FipsModuleState::Operational(summary) => FipsStatusReport {
            status: "OPERATIONAL".to_string(),
            fips_140_3_mode: enforced,
            security_level: "LEVEL_1_SOFTWARE_LEVEL_3_HSM_HYBRID".to_string(),
            self_tests: Some(summary),
            failure_detail: None,
            approved_algorithms: vec![
                "AES-256-GCM (NIST SP 800-38D)".to_string(),
                "SHA3-512 (NIST FIPS 202)".to_string(),
                "ML-DSA-87 (NIST FIPS 204)".to_string(),
                "ML-KEM-1024 (NIST FIPS 203)".to_string(),
                "BLAKE3 (Allowed Hashing Primitive)".to_string(),
                "Ed25519 (RFC 8032 - Allowed in Hybrid Anchor Mode)".to_string(),
            ],
        },
        FipsModuleState::Error(detail) => FipsStatusReport {
            status: "ERROR_STATE".to_string(),
            fips_140_3_mode: enforced,
            security_level: "INHIBITED".to_string(),
            self_tests: None,
            failure_detail: Some(detail),
            approved_algorithms: vec![],
        },
        FipsModuleState::Uninitialized => FipsStatusReport {
            status: "UNINITIALIZED".to_string(),
            fips_140_3_mode: enforced,
            security_level: "PENDING_SELF_TESTS".to_string(),
            self_tests: None,
            failure_detail: None,
            approved_algorithms: vec![],
        },
    }
}
