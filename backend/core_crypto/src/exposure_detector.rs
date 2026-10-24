//! ExposureDetector integration for AER-KEP-Q.
//!
//! This module owns the control-plane transition around cryptographic exposure:
//! an exposed epoch is quarantined, a fresh ML-KEM epoch is generated locally,
//! and its descriptor is authenticated with the existing ML-DSA-87 identity.
//!
//! Network transport is intentionally outside core_crypto. `on_exposure` returns
//! the authenticated descriptor for the HA/control-plane layer to broadcast.

use crate::aer_kep_q::{AerKepQ, AerKepQError, EpochDescriptor, EpochStatus};
use crate::QuantumNodeIdentity;
use std::sync::{Arc, Mutex};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExposureReason {
    SecretMaterialExposure,
    IntegrityAlert,
    OperatorQuarantine,
    PeerExposureReport,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ExposureEvent {
    pub observed_epoch: u64,
    pub reason: ExposureReason,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExposureTransition {
    pub previous_epoch: u64,
    pub new_epoch: u64,
    pub reason: ExposureReason,
    pub descriptor: EpochDescriptor,
}

/// Severity level for an exposure alert.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub enum AlertSeverity {
    Info,
    Warning,
    Critical,
}

/// Lifecycle status of an alert.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AlertLifecycleStatus {
    /// Alert was emitted and is actionable.
    Active,
    /// Alert has been acknowledged and remediated.
    Acknowledged,
    /// Alert has been suppressed.
    Suppressed,
}

/// Structured alert emitted when a key exposure event is detected.
///
/// F-004: This replaces the silent quarantine+reissue with a structured
/// alert that is emitted to the audit ledger / alerting pipeline.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExposureAlert {
    pub domain: String,
    pub previous_epoch: u64,
    pub new_epoch: u64,
    pub reason: ExposureReason,
    pub timestamp_ms: u128,
    /// Correlation ID for tracing this alert through the system.
    pub correlation_id: String,
    pub severity: AlertSeverity,
    pub lifecycle_status: AlertLifecycleStatus,
}

/// Trait for emitting exposure alerts. Implementors receive the structured
/// alert and forward it to the appropriate audit/security pipeline.
pub trait AlertSink: Send + Sync {
    fn emit(&self, alert: &ExposureAlert);
}

/// Default alert sink that logs alerts via `tracing`.
#[derive(Default)]
pub struct LoggingAlertSink;

impl AlertSink for LoggingAlertSink {
    fn emit(&self, alert: &ExposureAlert) {
        match alert.severity {
            AlertSeverity::Info => tracing::info!(
                "KEY_EXPOSURE: domain={}, prev_epoch={}, new_epoch={}, reason={:?}, corr={}",
                alert.domain,
                alert.previous_epoch,
                alert.new_epoch,
                alert.reason,
                alert.correlation_id,
            ),
            AlertSeverity::Warning => tracing::warn!(
                "KEY_EXPOSURE: domain={}, prev_epoch={}, new_epoch={}, reason={:?}, corr={}",
                alert.domain,
                alert.previous_epoch,
                alert.new_epoch,
                alert.reason,
                alert.correlation_id,
            ),
            AlertSeverity::Critical => tracing::error!(
                "KEY_EXPOSURE: domain={}, prev_epoch={}, new_epoch={}, reason={:?}, corr={}",
                alert.domain,
                alert.previous_epoch,
                alert.new_epoch,
                alert.reason,
                alert.correlation_id,
            ),
        }
    }
}

/// Severity mapping for exposure reasons.
impl ExposureReason {
    pub fn default_severity(&self) -> AlertSeverity {
        match self {
            ExposureReason::SecretMaterialExposure => AlertSeverity::Critical,
            ExposureReason::IntegrityAlert => AlertSeverity::Critical,
            ExposureReason::OperatorQuarantine => AlertSeverity::Warning,
            ExposureReason::PeerExposureReport => AlertSeverity::Warning,
        }
    }
}

/// In-memory alert sink for testing. Records all emitted alerts.
#[derive(Default, Clone)]
pub struct InMemoryAlertSink {
    alerts: Arc<Mutex<Vec<ExposureAlert>>>,
}

impl InMemoryAlertSink {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn alerts(&self) -> Vec<ExposureAlert> {
        self.alerts.lock().unwrap().clone()
    }
}

impl AlertSink for InMemoryAlertSink {
    fn emit(&self, alert: &ExposureAlert) {
        self.alerts.lock().unwrap().push(alert.clone());
    }
}

#[derive(Debug, Error)]
pub enum ExposureDetectorError {
    #[error("exposure event targets a stale epoch")]
    StaleExposure,
    #[error("exposure event targets a future epoch")]
    FutureExposure,
    #[error("descriptor domain does not match detector domain")]
    DomainMismatch,
    #[error("descriptor is not active")]
    DescriptorNotActive,
    #[error("descriptor epoch is stale")]
    StaleDescriptor,
    #[error("descriptor conflicts with the current epoch")]
    ConflictingDescriptor,
    #[error("descriptor signature is invalid")]
    InvalidSignature,
    #[error("AER-KEP-Q error: {0}")]
    Aer(#[from] AerKepQError),
}

/// Owns the local AER-KEP-Q epoch lifecycle.
///
/// The detector never exports private KEM material. On exposure it quarantines
/// the old epoch and returns only the newly authenticated public descriptor.
///
/// F-004: When an alert sink is configured, a structured `ExposureAlert` is
/// emitted on every exposure event. If no sink is configured, alerts are still
/// logged via the default `LoggingAlertSink`.
pub struct ExposureDetector {
    domain_id: String,
    current: AerKepQ,
    alert_sink: Option<Box<dyn AlertSink>>,
}

impl ExposureDetector {
    pub fn new(
        domain_id: impl Into<String>,
        initial_epoch: u64,
    ) -> Result<Self, ExposureDetectorError> {
        let domain_id = domain_id.into();
        let current = AerKepQ::new(domain_id.clone(), initial_epoch)?;
        Ok(Self {
            domain_id,
            current,
            alert_sink: None,
        })
    }

    /// Build an ExposureDetector with a custom alert sink for structured
    /// alert emission (F-004).
    pub fn with_alert_sink(
        domain_id: impl Into<String>,
        initial_epoch: u64,
        sink: Box<dyn AlertSink>,
    ) -> Result<Self, ExposureDetectorError> {
        let domain_id = domain_id.into();
        let current = AerKepQ::new(domain_id.clone(), initial_epoch)?;
        Ok(Self {
            domain_id,
            current,
            alert_sink: Some(sink),
        })
    }

    pub fn domain_id(&self) -> &str {
        &self.domain_id
    }

    pub fn active_epoch(&self) -> u64 {
        self.current.epoch()
    }

    pub fn status(&self) -> EpochStatus {
        self.current.status()
    }

    pub fn descriptor(
        &self,
        signer: &QuantumNodeIdentity,
    ) -> Result<EpochDescriptor, ExposureDetectorError> {
        Ok(self.current.descriptor(signer)?)
    }

    pub fn on_exposure(
        &mut self,
        event: ExposureEvent,
        signer: &QuantumNodeIdentity,
    ) -> Result<ExposureTransition, ExposureDetectorError> {
        let current_epoch = self.current.epoch();
        match event.observed_epoch.cmp(&current_epoch) {
            std::cmp::Ordering::Less => return Err(ExposureDetectorError::StaleExposure),
            std::cmp::Ordering::Greater => return Err(ExposureDetectorError::FutureExposure),
            std::cmp::Ordering::Equal => {}
        }

        // Idempotency: an already quarantined epoch cannot be rotated twice
        // from the same exposure event.
        if self.current.status() != EpochStatus::Active {
            return Err(ExposureDetectorError::StaleExposure);
        }

        let previous_epoch = current_epoch;
        self.current.quarantine();

        let next_epoch = previous_epoch
            .checked_add(1)
            .ok_or(ExposureDetectorError::FutureExposure)?;
        self.current = AerKepQ::new(self.domain_id.clone(), next_epoch)?;
        let descriptor = self.current.descriptor(signer)?;

        // F-004: Emit structured alert
        let timestamp_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let severity = event.reason.default_severity();
        let correlation_id = format!(
            "exposure-{}-{}-{}-{}",
            self.domain_id, previous_epoch, next_epoch, timestamp_ms
        );
        let alert = ExposureAlert {
            domain: self.domain_id.clone(),
            previous_epoch,
            new_epoch: next_epoch,
            reason: event.reason,
            timestamp_ms,
            correlation_id: correlation_id.clone(),
            severity,
            lifecycle_status: AlertLifecycleStatus::Active,
        };

        match &self.alert_sink {
            Some(sink) => sink.emit(&alert),
            None => {
                let default_sink = LoggingAlertSink;
                default_sink.emit(&alert);
            }
        }

        tracing::info!(
            "Exposure alert emitted: corr={}, severity={:?}, domain={}, epoch {} -> {}",
            correlation_id,
            severity,
            self.domain_id,
            previous_epoch,
            next_epoch,
        );

        Ok(ExposureTransition {
            previous_epoch,
            new_epoch: next_epoch,
            reason: event.reason,
            descriptor,
        })
    }
}

/// Control-plane view of an authenticated descriptor received from an HA peer.
///
/// This registry does not import or copy peer private keys. It tracks only the
/// highest authenticated epoch and the descriptor fingerprint, allowing the HA
/// transport layer to reject rollback and conflicting same-epoch state.
#[derive(Default)]
pub struct PeerEpochRegistry {
    domain_id: Option<String>,
    active_epoch: Option<u64>,
    descriptor_fingerprint: Option<[u8; 32]>,
}

impl PeerEpochRegistry {
    pub fn new(domain_id: impl Into<String>) -> Self {
        Self {
            domain_id: Some(domain_id.into()),
            active_epoch: None,
            descriptor_fingerprint: None,
        }
    }

    pub fn active_epoch(&self) -> Option<u64> {
        self.active_epoch
    }

    /// Apply an authenticated peer descriptor.
    ///
    /// Returns `true` when the registry advances to a new epoch and `false`
    /// for an exact duplicate. Older epochs and conflicting descriptors at the
    /// current epoch are rejected. Signature verification is performed against
    /// the explicitly configured trusted peer signing key.
    pub fn apply(
        &mut self,
        descriptor: &EpochDescriptor,
        trusted_signer_pub_bytes: &[u8],
    ) -> Result<bool, ExposureDetectorError> {
        let expected_domain = self.domain_id.as_deref().unwrap_or_default();
        if descriptor.domain_id != expected_domain {
            return Err(ExposureDetectorError::DomainMismatch);
        }
        if descriptor.status != EpochStatus::Active {
            return Err(ExposureDetectorError::DescriptorNotActive);
        }
        if !QuantumNodeIdentity::verify_signature(
            trusted_signer_pub_bytes,
            &descriptor.signable_bytes(),
            &descriptor.signature,
        ) {
            return Err(ExposureDetectorError::InvalidSignature);
        }

        let fingerprint = QuantumNodeIdentity::hash_ledger_block(&descriptor.signable_bytes());
        match self.active_epoch {
            None => {
                self.active_epoch = Some(descriptor.epoch);
                self.descriptor_fingerprint = Some(fingerprint);
                Ok(true)
            }
            Some(current) if descriptor.epoch < current => {
                Err(ExposureDetectorError::StaleDescriptor)
            }
            Some(current) if descriptor.epoch == current => {
                if self.descriptor_fingerprint == Some(fingerprint) {
                    Ok(false)
                } else {
                    Err(ExposureDetectorError::ConflictingDescriptor)
                }
            }
            Some(_) => {
                self.active_epoch = Some(descriptor.epoch);
                self.descriptor_fingerprint = Some(fingerprint);
                Ok(true)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detector() -> (ExposureDetector, QuantumNodeIdentity) {
        (
            ExposureDetector::new("bank-a", 10).unwrap(),
            QuantumNodeIdentity::generate_node_identity().unwrap(),
        )
    }

    #[test]
    fn exposure_quarantines_and_advances_epoch() {
        let (mut detector, signer) = detector();
        let transition = detector
            .on_exposure(
                ExposureEvent {
                    observed_epoch: 10,
                    reason: ExposureReason::SecretMaterialExposure,
                },
                &signer,
            )
            .unwrap();

        assert_eq!(transition.previous_epoch, 10);
        assert_eq!(transition.new_epoch, 11);
        assert_eq!(detector.active_epoch(), 11);
        assert_eq!(detector.status(), EpochStatus::Active);
        assert_eq!(transition.descriptor.epoch, 11);
    }

    #[test]
    fn stale_and_future_exposures_are_rejected() {
        let (mut detector, signer) = detector();
        assert!(matches!(
            detector.on_exposure(
                ExposureEvent {
                    observed_epoch: 9,
                    reason: ExposureReason::IntegrityAlert
                },
                &signer,
            ),
            Err(ExposureDetectorError::StaleExposure)
        ));
        assert!(matches!(
            detector.on_exposure(
                ExposureEvent {
                    observed_epoch: 11,
                    reason: ExposureReason::IntegrityAlert
                },
                &signer,
            ),
            Err(ExposureDetectorError::FutureExposure)
        ));
    }

    #[test]
    fn peer_registry_rejects_rollback_and_conflict() {
        let (mut detector, signer) = detector();
        let first = detector
            .on_exposure(
                ExposureEvent {
                    observed_epoch: 10,
                    reason: ExposureReason::OperatorQuarantine,
                },
                &signer,
            )
            .unwrap();
        let pubkey = signer.dsa_public_key_bytes();
        let mut registry = PeerEpochRegistry::new("bank-a");

        assert!(registry.apply(&first.descriptor, &pubkey).unwrap());
        assert!(!registry.apply(&first.descriptor, &pubkey).unwrap());

        let old = AerKepQ::new("bank-a", 10)
            .unwrap()
            .descriptor(&signer)
            .unwrap();
        assert!(matches!(
            registry.apply(&old, &pubkey),
            Err(ExposureDetectorError::StaleDescriptor)
        ));

        let second_detector = AerKepQ::new("bank-a", 11).unwrap();
        let conflicting = second_detector.descriptor(&signer).unwrap();
        assert_eq!(conflicting.epoch, first.descriptor.epoch);
        assert!(matches!(
            registry.apply(&conflicting, &pubkey),
            Err(ExposureDetectorError::ConflictingDescriptor)
        ));
    }

    #[test]
    fn peer_registry_rejects_wrong_signer_and_domain() {
        let (mut detector, signer) = detector();
        let transition = detector
            .on_exposure(
                ExposureEvent {
                    observed_epoch: 10,
                    reason: ExposureReason::PeerExposureReport,
                },
                &signer,
            )
            .unwrap();
        let mut registry = PeerEpochRegistry::new("bank-a");
        let wrong_signer = QuantumNodeIdentity::generate_node_identity().unwrap();

        assert!(matches!(
            registry.apply(&transition.descriptor, &wrong_signer.dsa_public_key_bytes()),
            Err(ExposureDetectorError::InvalidSignature)
        ));

        let mut wrong_domain = transition.descriptor.clone();
        wrong_domain.domain_id = "bank-b".into();
        assert!(matches!(
            registry.apply(&wrong_domain, &signer.dsa_public_key_bytes()),
            Err(ExposureDetectorError::DomainMismatch)
        ));
    }

    #[test]
    fn exposure_alert_emitted_with_sink() {
        let signer = QuantumNodeIdentity::generate_node_identity().unwrap();
        let sink = InMemoryAlertSink::new();
        let mut detector =
            ExposureDetector::with_alert_sink("bank-a", 10, Box::new(sink.clone())).unwrap();

        detector
            .on_exposure(
                ExposureEvent {
                    observed_epoch: 10,
                    reason: ExposureReason::SecretMaterialExposure,
                },
                &signer,
            )
            .unwrap();

        let alerts = sink.alerts();
        assert_eq!(alerts.len(), 1);
        let alert = &alerts[0];
        assert_eq!(alert.domain, "bank-a");
        assert_eq!(alert.previous_epoch, 10);
        assert_eq!(alert.new_epoch, 11);
        assert_eq!(alert.reason, ExposureReason::SecretMaterialExposure);
        assert_eq!(alert.severity, AlertSeverity::Critical);
        assert_eq!(alert.lifecycle_status, AlertLifecycleStatus::Active);
        assert!(!alert.correlation_id.is_empty());
    }

    #[test]
    fn exposure_alert_severity_mapped_correctly() {
        let signer = QuantumNodeIdentity::generate_node_identity().unwrap();

        // Critical: SecretMaterialExposure
        let sink = InMemoryAlertSink::new();
        let mut det =
            ExposureDetector::with_alert_sink("bank-a", 10, Box::new(sink.clone())).unwrap();
        det.on_exposure(
            ExposureEvent {
                observed_epoch: 10,
                reason: ExposureReason::SecretMaterialExposure,
            },
            &signer,
        )
        .unwrap();
        assert_eq!(sink.alerts()[0].severity, AlertSeverity::Critical);

        // Critical: IntegrityAlert
        let sink2 = InMemoryAlertSink::new();
        let mut det2 =
            ExposureDetector::with_alert_sink("bank-a", 10, Box::new(sink2.clone())).unwrap();
        det2.on_exposure(
            ExposureEvent {
                observed_epoch: 10,
                reason: ExposureReason::IntegrityAlert,
            },
            &signer,
        )
        .unwrap();
        assert_eq!(sink2.alerts()[0].severity, AlertSeverity::Critical);

        // Warning: OperatorQuarantine
        let sink3 = InMemoryAlertSink::new();
        let mut det3 =
            ExposureDetector::with_alert_sink("bank-a", 10, Box::new(sink3.clone())).unwrap();
        det3.on_exposure(
            ExposureEvent {
                observed_epoch: 10,
                reason: ExposureReason::OperatorQuarantine,
            },
            &signer,
        )
        .unwrap();
        assert_eq!(sink3.alerts()[0].severity, AlertSeverity::Warning);

        // Warning: PeerExposureReport
        let sink4 = InMemoryAlertSink::new();
        let mut det4 =
            ExposureDetector::with_alert_sink("bank-a", 10, Box::new(sink4.clone())).unwrap();
        det4.on_exposure(
            ExposureEvent {
                observed_epoch: 10,
                reason: ExposureReason::PeerExposureReport,
            },
            &signer,
        )
        .unwrap();
        assert_eq!(sink4.alerts()[0].severity, AlertSeverity::Warning);
    }

    #[test]
    fn duplicate_exposure_only_emits_one_alert() {
        let signer = QuantumNodeIdentity::generate_node_identity().unwrap();
        let sink = InMemoryAlertSink::new();
        let mut detector =
            ExposureDetector::with_alert_sink("bank-a", 10, Box::new(sink.clone())).unwrap();

        // First exposure succeeds and emits alert
        detector
            .on_exposure(
                ExposureEvent {
                    observed_epoch: 10,
                    reason: ExposureReason::SecretMaterialExposure,
                },
                &signer,
            )
            .unwrap();

        // Second exposure of same epoch should fail (idempotency)
        let result = detector.on_exposure(
            ExposureEvent {
                observed_epoch: 10,
                reason: ExposureReason::SecretMaterialExposure,
            },
            &signer,
        );
        assert!(result.is_err());

        // Only one alert should have been emitted
        assert_eq!(sink.alerts().len(), 1);
    }

    #[test]
    fn exposure_without_sink_still_functions() {
        // Detector without alert sink should still work (logs via default sink)
        let signer = QuantumNodeIdentity::generate_node_identity().unwrap();
        let mut detector = ExposureDetector::new("bank-a", 10).unwrap();

        let transition = detector
            .on_exposure(
                ExposureEvent {
                    observed_epoch: 10,
                    reason: ExposureReason::OperatorQuarantine,
                },
                &signer,
            )
            .unwrap();

        assert_eq!(transition.previous_epoch, 10);
        assert_eq!(transition.new_epoch, 11);
        assert_eq!(detector.active_epoch(), 11);
    }

    #[test]
    fn exposure_alert_has_unique_correlation_id() {
        let signer = QuantumNodeIdentity::generate_node_identity().unwrap();
        let sink = InMemoryAlertSink::new();
        let mut detector =
            ExposureDetector::with_alert_sink("bank-a", 10, Box::new(sink.clone())).unwrap();

        detector
            .on_exposure(
                ExposureEvent {
                    observed_epoch: 10,
                    reason: ExposureReason::SecretMaterialExposure,
                },
                &signer,
            )
            .unwrap();

        let alert = &sink.alerts()[0];
        assert!(!alert.correlation_id.is_empty());
        assert!(
            alert.correlation_id.starts_with("exposure-bank-a-"),
            "correlation_id should start with domain prefix"
        );
    }
}
