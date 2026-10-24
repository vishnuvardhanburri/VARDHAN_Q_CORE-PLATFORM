use blake3::Hasher;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResiliencePolicy {
    pub production: bool,
    pub min_nodes: u16,
    pub require_kms: bool,
    pub backup_enabled: bool,
    pub regions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BackupManifest {
    pub snapshot_id: String,
    pub organization_id: String,
    pub store_digests: Vec<String>,
    pub key_registry_version: u64,
    pub created_at_ms: u64,
    pub manifest_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpgradeGuard {
    pub current_release: u64,
    pub minimum_rollback_release: u64,
    pub schema_version: u64,
}

#[derive(Debug, Error)]
pub enum ResilienceError {
    #[error("production deployments require at least three control-plane nodes")]
    InsufficientNodes,
    #[error("production deployments require KMS/HSM-backed key protection")]
    KmsRequired,
    #[error("production deployments require backups")]
    BackupRequired,
    #[error("at least one deployment region is required")]
    MissingRegion,
    #[error("deployment regions must be unique")]
    DuplicateRegion,
    #[error("backup snapshot id is required")]
    MissingSnapshot,
    #[error("backup organization binding is required")]
    MissingOrganization,
    #[error("backup store digest is invalid")]
    InvalidDigest,
    #[error("rollback would cross the configured rollback floor")]
    RollbackBlocked,
    #[error("release must advance monotonically")]
    ReleaseRegression,
}

pub fn validate_policy(policy: &ResiliencePolicy) -> Result<(), ResilienceError> {
    if policy.production && policy.min_nodes < 3 {
        return Err(ResilienceError::InsufficientNodes);
    }
    if policy.production && !policy.require_kms {
        return Err(ResilienceError::KmsRequired);
    }
    if policy.production && !policy.backup_enabled {
        return Err(ResilienceError::BackupRequired);
    }
    if policy.regions.is_empty() {
        return Err(ResilienceError::MissingRegion);
    }
    let unique: BTreeSet<_> = policy
        .regions
        .iter()
        .filter(|r| !r.trim().is_empty())
        .collect();
    if unique.len() != policy.regions.len()
        || unique.len()
            != policy
                .regions
                .iter()
                .filter(|r| !r.trim().is_empty())
                .count()
    {
        return Err(ResilienceError::DuplicateRegion);
    }
    Ok(())
}

pub fn build_backup_manifest(
    snapshot_id: &str,
    organization_id: &str,
    store_digests: Vec<String>,
    key_registry_version: u64,
    created_at_ms: u64,
) -> Result<BackupManifest, ResilienceError> {
    if snapshot_id.trim().is_empty() {
        return Err(ResilienceError::MissingSnapshot);
    }
    if organization_id.trim().is_empty() {
        return Err(ResilienceError::MissingOrganization);
    }
    if store_digests
        .iter()
        .any(|digest| digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return Err(ResilienceError::InvalidDigest);
    }
    let mut hasher = Hasher::new();
    hasher.update(snapshot_id.as_bytes());
    hasher.update(&[0]);
    hasher.update(organization_id.as_bytes());
    hasher.update(&[0]);
    for digest in &store_digests {
        hasher.update(digest.as_bytes());
        hasher.update(&[0]);
    }
    hasher.update(&key_registry_version.to_le_bytes());
    hasher.update(&created_at_ms.to_le_bytes());
    Ok(BackupManifest {
        snapshot_id: snapshot_id.to_owned(),
        organization_id: organization_id.to_owned(),
        store_digests,
        key_registry_version,
        created_at_ms,
        manifest_hash: hasher.finalize().to_hex().to_string(),
    })
}

pub fn verify_backup_manifest(manifest: &BackupManifest) -> bool {
    build_backup_manifest(
        &manifest.snapshot_id,
        &manifest.organization_id,
        manifest.store_digests.clone(),
        manifest.key_registry_version,
        manifest.created_at_ms,
    )
    .map(|expected| expected.manifest_hash == manifest.manifest_hash)
    .unwrap_or(false)
}

impl UpgradeGuard {
    pub fn validate_upgrade(
        &self,
        target_release: u64,
        target_schema: u64,
    ) -> Result<(), ResilienceError> {
        if target_release < self.current_release {
            return Err(ResilienceError::ReleaseRegression);
        }
        if target_schema < self.schema_version {
            return Err(ResilienceError::ReleaseRegression);
        }
        Ok(())
    }

    pub fn validate_rollback(&self, target_release: u64) -> Result<(), ResilienceError> {
        if target_release < self.minimum_rollback_release {
            return Err(ResilienceError::RollbackBlocked);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_policy_requires_ha_kms_and_backup() {
        let mut policy = ResiliencePolicy {
            production: true,
            min_nodes: 1,
            require_kms: false,
            backup_enabled: false,
            regions: vec!["in-1".into()],
        };
        assert!(matches!(
            validate_policy(&policy),
            Err(ResilienceError::InsufficientNodes)
        ));
        policy.min_nodes = 3;
        assert!(matches!(
            validate_policy(&policy),
            Err(ResilienceError::KmsRequired)
        ));
        policy.require_kms = true;
        assert!(matches!(
            validate_policy(&policy),
            Err(ResilienceError::BackupRequired)
        ));
        policy.backup_enabled = true;
        assert!(validate_policy(&policy).is_ok());
    }

    #[test]
    fn backup_manifest_is_tenant_bound_and_tamper_evident() {
        let digest = "a".repeat(64);
        let manifest = build_backup_manifest("snap-1", "org-a", vec![digest], 7, 10).unwrap();
        assert!(verify_backup_manifest(&manifest));
        let mut tampered = manifest.clone();
        tampered.organization_id = "org-b".into();
        assert!(!verify_backup_manifest(&tampered));
    }

    #[test]
    fn rollback_floor_and_release_monotonicity_are_enforced() {
        let guard = UpgradeGuard {
            current_release: 10,
            minimum_rollback_release: 8,
            schema_version: 4,
        };
        assert!(guard.validate_upgrade(11, 5).is_ok());
        assert!(guard.validate_upgrade(9, 5).is_err());
        assert!(guard.validate_rollback(8).is_ok());
        assert!(guard.validate_rollback(7).is_err());
    }
}
