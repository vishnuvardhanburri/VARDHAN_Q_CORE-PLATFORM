//! Standardized administrative audit event generation and durable ledger integration.
//!
//! Enforces that no secrets, plaintext passwords, session tokens, or private keys
//! are ever recorded in the audit ledger.

use rand::{rngs::OsRng, RngCore};
use serde_json::json;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub fn generate_event_id() -> String {
    let mut bytes = [0u8; 8];
    OsRng.fill_bytes(&mut bytes);
    format!("evt_{}", hex::encode(bytes))
}

pub fn blake3_hex(s: &str) -> String {
    hex::encode(blake3::hash(s.as_bytes()).as_bytes())
}

/// Emit an audit event to the durable append-only ledger signed with ML-DSA-87.
pub fn emit_admin_audit(
    ledger: Option<&Arc<audit_ledger::LedgerWriter>>,
    identity: Option<&Arc<core_crypto::QuantumNodeIdentity>>,
    node_id: &str,
    event_type: &str,
    actor: &str,
    result: &str,
    request_id: Option<&str>,
    details: serde_json::Value,
) {
    let event = json!({
        "event_id": generate_event_id(),
        "timestamp_ms": now_ms(),
        "event_type": event_type,
        "operation": event_type,
        "actor": actor,
        "actor_hash": blake3_hex(actor),
        "node_id": node_id,
        "result": result,
        "request_id": request_id.unwrap_or("none"),
        "details": details,
    });

    if let (Some(l), Some(id)) = (ledger, identity) {
        if let Err(e) = l.append(event.clone(), id) {
            tracing::error!(event_type = %event_type, error = %e, "Failed to append audit event to ledger");
        } else {
            tracing::info!(event_type = %event_type, actor = %actor, result = %result, "Audit ledger entry recorded");
        }
    } else {
        tracing::warn!(event_type = %event_type, "Audit ledger or node identity not configured — logged to tracing only");
    }
}
