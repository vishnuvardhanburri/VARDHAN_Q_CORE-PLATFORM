use core_crypto::QuantumNodeIdentity;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MeteringInvoiceReceipt {
    pub tenant_id: String,
    pub bytes_shielded: u64,
    pub requests_processed: u64,
    pub blake3_audit_hash: [u8; 32],
    pub signature: Vec<u8>,
}

pub struct UsageMeter {
    pub tenant_id: String,
    bytes_shielded: AtomicU64,
    requests_processed: AtomicU64,
}

impl UsageMeter {
    pub fn new(tenant_id: String) -> Self {
        Self {
            tenant_id,
            bytes_shielded: AtomicU64::new(0),
            requests_processed: AtomicU64::new(0),
        }
    }

    pub fn record_transaction(&self, payload_len: usize) {
        self.bytes_shielded
            .fetch_add(payload_len as u64, Ordering::Relaxed);
        self.requests_processed.fetch_add(1, Ordering::Relaxed);
    }

    pub fn generate_signed_receipt(
        &self,
        identity: &QuantumNodeIdentity,
    ) -> MeteringInvoiceReceipt {
        let bytes = self.bytes_shielded.load(Ordering::Relaxed);
        let reqs = self.requests_processed.load(Ordering::Relaxed);

        let raw_summary = format!("{}:{}:{}", self.tenant_id, bytes, reqs);
        let audit_hash = QuantumNodeIdentity::hash_ledger_block(raw_summary.as_bytes());
        let signature = identity.sign_payload(&audit_hash).unwrap_or_default();

        MeteringInvoiceReceipt {
            tenant_id: self.tenant_id.clone(),
            bytes_shielded: bytes,
            requests_processed: reqs,
            blake3_audit_hash: audit_hash,
            signature,
        }
    }
}
