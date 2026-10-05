//! Operational publisher for the canonical `vardhan_receipt` transport boundary.
//!
//! This binary is intentionally thin: it accepts a sealed canonical receipt on stdin and
//! sends it through the authenticated Q-Core service transport. It is useful for deployment
//! smoke tests and for runtimes that invoke the receipt engine as a subprocess. The signing
//! identity remains in the producer keystore; this process never accepts public keys from the
//! caller and never bypasses control-plane verification.

use std::io::{self, Read};
use vardhan_receipt::qcore_transport::publish_receipt;
use vardhan_receipt::VardhanSealedReceipt;

#[tokio::main]
async fn main() {
    let organization_id = match std::env::var("VARDHAN_QCORE_ORGANIZATION_ID") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => {
            eprintln!("VARDHAN_QCORE_ORGANIZATION_ID is required");
            std::process::exit(2);
        }
    };

    let mut input = String::new();
    if let Err(error) = io::stdin().read_to_string(&mut input) {
        eprintln!("failed to read receipt from stdin: {error}");
        std::process::exit(2);
    }

    let receipt: VardhanSealedReceipt = match serde_json::from_str(&input) {
        Ok(receipt) => receipt,
        Err(error) => {
            eprintln!("invalid canonical receipt JSON: {error}");
            std::process::exit(2);
        }
    };

    match publish_receipt(&organization_id, &receipt).await {
        Ok(result) => {
            println!("{}", serde_json::to_string(&result).unwrap_or_else(|_| "{\"status\":\"accepted\"}".into()));
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
