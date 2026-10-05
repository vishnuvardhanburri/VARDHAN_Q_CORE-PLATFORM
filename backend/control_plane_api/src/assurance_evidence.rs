use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EvidenceRecord {
    pub evidence_id: String,
    pub organization_id: String,
    pub category: String,
    pub source_ref: String,
    pub content_hash: String,
    pub control_refs: Vec<String>,
    pub collected_at_ms: u64,
    pub previous_evidence_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EvidenceManifest {
    pub organization_id: String,
    pub release_ref: String,
    pub generated_at_ms: u64,
    pub records: Vec<EvidenceRecord>,
    pub manifest_hash: String,
}

#[derive(Debug, Error)]
pub enum EvidenceError {
    #[error("organization id is required")]
    MissingOrganization,
    #[error("release reference is required")]
    MissingRelease,
    #[error("evidence source must be explicit")]
    MissingSource,
    #[error("evidence content hash is invalid")]
    InvalidHash,
}

pub fn hash_content(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

pub fn record(
    organization_id: &str,
    category: &str,
    source_ref: &str,
    content: &[u8],
    controls: Vec<String>,
    previous_evidence_hash: Option<String>,
) -> Result<EvidenceRecord, EvidenceError> {
    if organization_id.trim().is_empty() { return Err(EvidenceError::MissingOrganization); }
    if source_ref.trim().is_empty() { return Err(EvidenceError::MissingSource); }
    let content_hash = hash_content(content);
    if content_hash.len() != 64 { return Err(EvidenceError::InvalidHash); }
    let collected_at_ms = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| EvidenceError::InvalidHash)?.as_millis() as u64;
    let seed = format!("{organization_id}:{category}:{source_ref}:{content_hash}:{collected_at_ms}");
    let evidence_id = blake3::hash(seed.as_bytes()).to_hex().to_string();
    Ok(EvidenceRecord {
        evidence_id,
        organization_id: organization_id.to_owned(),
        category: category.to_owned(),
        source_ref: source_ref.to_owned(),
        content_hash,
        control_refs: controls,
        collected_at_ms,
        previous_evidence_hash,
    })
}

pub fn build_manifest(
    organization_id: &str,
    release_ref: &str,
    records: Vec<EvidenceRecord>,
) -> Result<EvidenceManifest, EvidenceError> {
    if organization_id.trim().is_empty() { return Err(EvidenceError::MissingOrganization); }
    if release_ref.trim().is_empty() { return Err(EvidenceError::MissingRelease); }
    if records.iter().any(|record| record.organization_id != organization_id) {
        return Err(EvidenceError::MissingOrganization);
    }
    let generated_at_ms = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| EvidenceError::InvalidHash)?.as_millis() as u64;
    let canonical = serde_json::to_vec(&(organization_id, release_ref, generated_at_ms, &records)).map_err(|_| EvidenceError::InvalidHash)?;
    let manifest_hash = blake3::hash(&canonical).to_hex().to_string();
    Ok(EvidenceManifest { organization_id: organization_id.to_owned(), release_ref: release_ref.to_owned(), generated_at_ms, records, manifest_hash })
}

pub fn verify_manifest(manifest: &EvidenceManifest) -> bool {
    if manifest.organization_id.trim().is_empty() || manifest.release_ref.trim().is_empty() {
        return false;
    }
    if manifest.records.iter().any(|record| record.organization_id != manifest.organization_id || record.content_hash.len() != 64) {
        return false;
    }
    let canonical = match serde_json::to_vec(&(
        manifest.organization_id.as_str(),
        manifest.release_ref.as_str(),
        manifest.generated_at_ms,
        &manifest.records,
    )) {
        Ok(value) => value,
        Err(_) => return false,
    };
    blake3::hash(&canonical).to_string() == manifest.manifest_hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_tenant_bound_and_tamper_evident() {
        let first = record("org-a", "release", "commit:abc", b"artifact", vec!["SC-1".into()], None).unwrap();
        let manifest = build_manifest("org-a", "abc", vec![first]).unwrap();
        assert!(verify_manifest(&manifest));

        let mut tampered = manifest.clone();
        tampered.organization_id = "org-b".into();
        assert!(!verify_manifest(&tampered));

        let mut tampered = manifest.clone();
        tampered.records[0].content_hash = "0".repeat(64);
        assert!(!verify_manifest(&tampered));
    }

    #[test]
    fn cross_tenant_records_are_rejected() {
        let a = record("org-a", "access_review", "review:1", b"review", vec!["AC-2".into()], None).unwrap();
        let b = record("org-b", "policy_history", "policy:1", b"policy", vec!["CM-3".into()], None).unwrap();
        assert!(matches!(build_manifest("org-a", "release", vec![a, b]), Err(EvidenceError::MissingOrganization)));
    }
}
