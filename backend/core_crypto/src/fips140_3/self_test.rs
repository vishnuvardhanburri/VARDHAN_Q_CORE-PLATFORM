//! Vardhan Q-Core -- FIPS 140-3 Power-On and Conditional Self-Test Engine
//!
//! Enforces FIPS 140-3 Section 9 (Self-Tests) lifecycle requirements:
//! - Pre-operational / Power-On Self-Tests (POST): KATs for AES-GCM, SHA3, BLAKE3, Ed25519, ML-DSA-87, ML-KEM-1024, Integrity.
//! - Conditional Self-Tests: Pairwise Consistency Tests (PCT) on key generation and Continuous RNG Health Test.
//! - Critical failure handling: Immediate transition to fail-closed Error state and zeroization of SSPs.

use crate::fips140_3::kat::*;
use crate::fips140_3::zeroize_ssp::zeroize_all_transient_ssps;
use fips204::ml_dsa_87;
use fips204::traits::{Signer, Verifier};
use ml_kem::kem::{Decapsulate, Encapsulate};
use ml_kem::{KemCore, MlKem1024};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum FipsError {
    #[error("FIPS 140-3 Module is in error state: {0}")]
    ModuleInErrorState(String),
    #[error("FIPS 140-3 Known Answer Test failed for algorithm {algorithm}: {detail}")]
    KatFailure {
        algorithm: &'static str,
        detail: String,
    },
    #[error("FIPS 140-3 Pairwise Consistency Test failed for {algorithm}: {detail}")]
    PairwiseConsistencyFailure {
        algorithm: &'static str,
        detail: String,
    },
    #[error("FIPS 140-3 Entropy Source Health Test failed: {0}")]
    EntropyHealthFailure(String),
    #[error("Internal concurrency error accessing FIPS state: {0}")]
    StateLockError(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TestVerdict {
    Pass,
    Fail,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FipsVerificationSummary {
    pub aes_256_gcm_kat: TestVerdict,
    pub sha3_512_kat: TestVerdict,
    pub blake3_kat: TestVerdict,
    pub ed25519_kat: TestVerdict,
    pub ml_dsa_87_kat: TestVerdict,
    pub ml_kem_1024_kat: TestVerdict,
    pub module_integrity_kat: TestVerdict,
    pub timestamp_ms: u128,
    pub execution_time_micros: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FipsFailureDetail {
    pub failed_test: String,
    pub reason: String,
    pub failure_timestamp_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FipsModuleState {
    Uninitialized,
    Operational(FipsVerificationSummary),
    Error(FipsFailureDetail),
}

static FIPS_STATE: RwLock<FipsModuleState> = RwLock::new(FipsModuleState::Uninitialized);

/// Returns the current FIPS 140-3 module operational state.
pub fn get_fips_module_state() -> FipsModuleState {
    FIPS_STATE
        .read()
        .map(|s| s.clone())
        .unwrap_or(FipsModuleState::Error(FipsFailureDetail {
            failed_test: "FIPS_STATE_LOCK".to_string(),
            reason: "RwLock poisoned".to_string(),
            failure_timestamp_ms: current_timestamp_ms(),
        }))
}

/// Executes all Power-On Self-Tests (POST) and algorithm KATs.
///
/// If `fault_injection` is `Some("algo_name")`, simulates a failure
/// for testing fail-closed error transitions.
pub fn run_power_on_self_tests(
    fault_injection: Option<&str>,
) -> Result<FipsVerificationSummary, FipsError> {
    let start_instant = std::time::Instant::now();
    let now_ms = current_timestamp_ms();

    let mut summary = FipsVerificationSummary {
        aes_256_gcm_kat: TestVerdict::Fail,
        sha3_512_kat: TestVerdict::Fail,
        blake3_kat: TestVerdict::Fail,
        ed25519_kat: TestVerdict::Fail,
        ml_dsa_87_kat: TestVerdict::Fail,
        ml_kem_1024_kat: TestVerdict::Fail,
        module_integrity_kat: TestVerdict::Fail,
        timestamp_ms: now_ms,
        execution_time_micros: 0,
    };

    // 1. AES-256-GCM KAT
    if fault_injection == Some("aes_gcm") {
        return handle_failure(
            "AES-256-GCM",
            "Simulated fault injection failure in AES-GCM KAT",
        );
    }
    run_aes_256_gcm_kat().map_err(|e| kat_failure_detail("AES-256-GCM", e.to_string()))?;
    summary.aes_256_gcm_kat = TestVerdict::Pass;

    // 2. SHA3-512 KAT
    if fault_injection == Some("sha3") {
        return handle_failure("SHA3-512", "Simulated fault injection failure in SHA3 KAT");
    }
    run_sha3_512_kat().map_err(|e| kat_failure_detail("SHA3-512", e.to_string()))?;
    summary.sha3_512_kat = TestVerdict::Pass;

    // 3. BLAKE3 KAT
    if fault_injection == Some("blake3") {
        return handle_failure("BLAKE3", "Simulated fault injection failure in BLAKE3 KAT");
    }
    run_blake3_kat().map_err(|e| kat_failure_detail("BLAKE3", e.to_string()))?;
    summary.blake3_kat = TestVerdict::Pass;

    // 4. Ed25519 KAT
    if fault_injection == Some("ed25519") {
        return handle_failure(
            "Ed25519",
            "Simulated fault injection failure in Ed25519 KAT",
        );
    }
    run_ed25519_kat().map_err(|e| kat_failure_detail("Ed25519", e.to_string()))?;
    summary.ed25519_kat = TestVerdict::Pass;

    // 5. ML-DSA-87 KAT
    if fault_injection == Some("ml_dsa_87") {
        return handle_failure(
            "ML-DSA-87",
            "Simulated fault injection failure in ML-DSA-87 KAT",
        );
    }
    run_ml_dsa_87_kat().map_err(|e| kat_failure_detail("ML-DSA-87", e.to_string()))?;
    summary.ml_dsa_87_kat = TestVerdict::Pass;

    // 6. ML-KEM-1024 KAT
    if fault_injection == Some("ml_kem_1024") {
        return handle_failure(
            "ML-KEM-1024",
            "Simulated fault injection failure in ML-KEM-1024 KAT",
        );
    }
    run_ml_kem_1024_kat().map_err(|e| kat_failure_detail("ML-KEM-1024", e.to_string()))?;
    summary.ml_kem_1024_kat = TestVerdict::Pass;

    // 7. Module Software Integrity Self-Test
    if fault_injection == Some("integrity") {
        return handle_failure(
            "ModuleIntegrity",
            "Simulated fault injection failure in Module Integrity Self-Test",
        );
    }
    run_module_integrity_kat().map_err(|e| kat_failure_detail("ModuleIntegrity", e.to_string()))?;
    summary.module_integrity_kat = TestVerdict::Pass;

    summary.execution_time_micros = start_instant.elapsed().as_micros() as u64;

    // All self-tests passed: set state to Operational
    let mut state = FIPS_STATE
        .write()
        .map_err(|e| FipsError::StateLockError(e.to_string()))?;
    *state = FipsModuleState::Operational(summary.clone());

    tracing::info!(
        duration_micros = summary.execution_time_micros,
        "FIPS 140-3 Power-On Self-Tests (POST) verified: all KATs passed"
    );

    Ok(summary)
}

fn kat_failure_detail(algorithm: &'static str, detail: String) -> FipsError {
    let _ = handle_failure(algorithm, &detail);
    FipsError::KatFailure { algorithm, detail }
}

fn handle_failure(
    algorithm: &'static str,
    reason: &str,
) -> Result<FipsVerificationSummary, FipsError> {
    // 1. Zeroize all transient Sensitive Security Parameters (SSPs)
    zeroize_all_transient_ssps();

    // 2. Set module state to Error (inhibits all crypto operations)
    let failure_detail = FipsFailureDetail {
        failed_test: algorithm.to_string(),
        reason: reason.to_string(),
        failure_timestamp_ms: current_timestamp_ms(),
    };

    if let Ok(mut state) = FIPS_STATE.write() {
        *state = FipsModuleState::Error(failure_detail);
    }

    tracing::error!(
        algorithm = algorithm,
        reason = reason,
        "FIPS 140-3 CRITICAL: Self-test failure detected. Module entered fail-closed error state."
    );

    Err(FipsError::KatFailure {
        algorithm,
        detail: reason.to_string(),
    })
}

/// Asserts that the FIPS cryptographic module is in the Operational state.
/// If uninitialized, triggers self-tests automatically.
/// If in Error state, returns `FipsError::ModuleInErrorState`.
pub fn assert_fips_operational() -> Result<(), FipsError> {
    let current_state = get_fips_module_state();
    match current_state {
        FipsModuleState::Operational(_) => Ok(()),
        FipsModuleState::Uninitialized => run_power_on_self_tests(None).map(|_| ()),
        FipsModuleState::Error(detail) => Err(FipsError::ModuleInErrorState(format!(
            "Module in ERROR state due to test failure: {} ({})",
            detail.failed_test, detail.reason
        ))),
    }
}

/// FIPS 140-3 Section 9.3.2 Pairwise Consistency Test (PCT) for asymmetric signature keypairs.
/// Must be executed immediately after key generation before the key is used.
pub fn run_pairwise_consistency_test_dsa(
    pk: &ml_dsa_87::PublicKey,
    sk: &ml_dsa_87::PrivateKey,
) -> Result<(), FipsError> {
    let probe = b"VARDHAN-QCORE-PAIRWISE-CONSISTENCY-TEST-DSA";
    let sig = sk
        .try_sign(probe, &[])
        .map_err(|e| FipsError::PairwiseConsistencyFailure {
            algorithm: "ML-DSA-87",
            detail: format!("Signing failed during PCT: {e}"),
        })?;

    if !pk.verify(probe, &sig, &[]) {
        return Err(FipsError::PairwiseConsistencyFailure {
            algorithm: "ML-DSA-87",
            detail: "Signature verification failed on freshly generated keypair".to_string(),
        });
    }

    Ok(())
}

/// FIPS 140-3 Section 9.3.2 Pairwise Consistency Test (PCT) for key encapsulation mechanisms (KEM).
/// Must be executed immediately after KEM key generation before the key is used.
pub fn run_pairwise_consistency_test_kem(
    ek: &<MlKem1024 as KemCore>::EncapsulationKey,
    dk: &<MlKem1024 as KemCore>::DecapsulationKey,
) -> Result<(), FipsError> {
    let (ciphertext, ss_enc) =
        ek.encapsulate(&mut OsRng)
            .map_err(|_| FipsError::PairwiseConsistencyFailure {
                algorithm: "ML-KEM-1024",
                detail: "Encapsulation failed during PCT".to_string(),
            })?;

    let ss_dec =
        dk.decapsulate(&ciphertext)
            .map_err(|_| FipsError::PairwiseConsistencyFailure {
                algorithm: "ML-KEM-1024",
                detail: "Decapsulation failed during PCT".to_string(),
            })?;

    if ss_enc.as_slice() != ss_dec.as_slice() {
        return Err(FipsError::PairwiseConsistencyFailure {
            algorithm: "ML-KEM-1024",
            detail: "Decapsulated shared secret does not match encapsulated secret during PCT"
                .to_string(),
        });
    }

    Ok(())
}

/// Continuous Random Number Generator Test (CRNGT) / Entropy Health Test per SP 800-90B.
/// Verifies that successive blocks from the OS entropy source do not produce identical outputs.
pub fn run_entropy_health_test() -> Result<(), FipsError> {
    let mut block1 = [0u8; 32];
    let mut block2 = [0u8; 32];

    OsRng.fill_bytes(&mut block1);
    OsRng.fill_bytes(&mut block2);

    if block1 == [0u8; 32] || block2 == [0u8; 32] {
        return Err(FipsError::EntropyHealthFailure(
            "Entropy source produced all-zero block".to_string(),
        ));
    }

    if block1 == block2 {
        return Err(FipsError::EntropyHealthFailure(
            "Entropy source repeated identical consecutive 32-byte blocks (stuck bit condition)"
                .to_string(),
        ));
    }

    Ok(())
}

fn current_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}
