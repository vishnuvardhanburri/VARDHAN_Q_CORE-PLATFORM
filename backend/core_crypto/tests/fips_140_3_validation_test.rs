//! Vardhan Q-Core -- FIPS 140-3 Cryptographic Self-Test & Validation Suite
//!
//! Automated verification testing for:
//! 1. All Power-On Self-Test (POST) Known Answer Tests (KAT)
//! 2. Pairwise Consistency Tests (PCT) on key generation
//! 3. Continuous Random Number Generator Tests (CRNGT / SP 800-90B)
//! 4. Fault injection and fail-closed error transitions
//! 5. FIPS telemetry and status reporting

use core_crypto::fips140_3::*;
use fips204::ml_dsa_87;
use ml_kem::{KemCore, MlKem1024};
use rand::rngs::OsRng;

#[test]
fn test_fips_power_on_self_tests_all_pass() {
    let summary = run_power_on_self_tests(None).expect("All FIPS 140-3 POST KATs must pass");

    assert_eq!(summary.aes_256_gcm_kat, TestVerdict::Pass);
    assert_eq!(summary.sha3_512_kat, TestVerdict::Pass);
    assert_eq!(summary.blake3_kat, TestVerdict::Pass);
    assert_eq!(summary.ed25519_kat, TestVerdict::Pass);
    assert_eq!(summary.ml_dsa_87_kat, TestVerdict::Pass);
    assert_eq!(summary.ml_kem_1024_kat, TestVerdict::Pass);
    assert_eq!(summary.module_integrity_kat, TestVerdict::Pass);

    assert!(summary.execution_time_micros > 0);
    assert_fips_operational().expect("Module must be in Operational state after successful POST");
}

#[test]
fn test_fips_fault_injection_fails_closed() {
    // 1. Simulate fault injection in AES-GCM
    let result = run_power_on_self_tests(Some("aes_gcm"));
    assert!(result.is_err(), "Fault injection must fail");

    // 2. Cryptographic operations must now be inhibited
    let op_check = assert_fips_operational();
    assert!(
        op_check.is_err(),
        "Module must inhibit operations when in Error state"
    );

    let state = get_fips_module_state();
    match state {
        FipsModuleState::Error(detail) => {
            assert_eq!(detail.failed_test, "AES-256-GCM");
        }
        _ => panic!("Expected FipsModuleState::Error"),
    }

    // 3. Reset module by running clean POST
    let recovery =
        run_power_on_self_tests(None).expect("Clean POST must recover module to Operational");
    assert_eq!(recovery.aes_256_gcm_kat, TestVerdict::Pass);
    assert_fips_operational().expect("Module must recover to Operational");
}

#[test]
fn test_fips_pairwise_consistency_dsa() {
    let (pk, sk) = ml_dsa_87::try_keygen().expect("ML-DSA-87 keygen failed");
    run_pairwise_consistency_test_dsa(&pk, &sk)
        .expect("Pairwise consistency test must succeed for valid keypair");
}

#[test]
fn test_fips_pairwise_consistency_kem() {
    let (dk, ek) = MlKem1024::generate(&mut OsRng);
    run_pairwise_consistency_test_kem(&ek, &dk)
        .expect("Pairwise consistency test must succeed for valid KEM keypair");
}

#[test]
fn test_fips_entropy_health_test() {
    run_entropy_health_test().expect("OS entropy health test must pass");
}

#[test]
fn test_fips_status_report() {
    let _ = run_power_on_self_tests(None);
    let report = get_fips_status_report();

    assert_eq!(report.status, "OPERATIONAL");
    assert_eq!(report.security_level, "LEVEL_1_SOFTWARE_LEVEL_3_HSM_HYBRID");
    assert!(report.self_tests.is_some());
    assert!(!report.approved_algorithms.is_empty());

    let json = serde_json::to_string_pretty(&report).expect("Status report must serialize to JSON");
    assert!(json.contains("OPERATIONAL"));
    assert!(json.contains("AES-256-GCM"));
    assert!(json.contains("ML-DSA-87"));
}
