use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Debug)]
pub struct DoraComplianceLog {
    pub timestamp_epoch_sec: u64,
    pub dora_article_reference: String, // e.g., "Article 9: Protection & Prevention"
    pub nis2_directive_ref: String,     // e.g., "Article 21: Cryptography & Encryption"
    pub key_encapsulation_alg: String,  // "FIPS 203 (ML-KEM-1024)"
    pub digital_signature_alg: String,  // "FIPS 204 (ML-DSA-87)"
    pub session_entropy_bits: f64,      // Target >= 7.9900
    pub bytes_shielded: usize,
    pub crypto_agile_status: String, // "ACTIVE_PQ_ENVELOPED"
}

pub struct ComplianceExporter;

impl ComplianceExporter {
    pub fn export_dora_audit(
        output_path: &Path,
        bytes_shielded: usize,
        entropy: f64,
    ) -> Result<(), std::io::Error> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let log_entry = DoraComplianceLog {
            timestamp_epoch_sec: timestamp,
            dora_article_reference: "DORA_ART_9_2_CRYPTOGRAPHIC_SHIELD".to_string(),
            nis2_directive_ref: "NIS2_ART_21_2_QUANTUM_AGILITY".to_string(),
            key_encapsulation_alg: "FIPS 203 (ML-KEM-1024)".to_string(),
            digital_signature_alg: "FIPS 204 (ML-DSA-87)".to_string(),
            session_entropy_bits: entropy,
            bytes_shielded,
            crypto_agile_status: "ACTIVE_PQ_ENVELOPED".to_string(),
        };

        let json_line = serde_json::to_string(&log_entry)? + "\n";
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(output_path)?;

        file.write_all(json_line.as_bytes())?;
        Ok(())
    }
}
