use std::fs;
use ed25519_dalek::{VerifyingKey as PublicKey, Signature, Verifier};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

// In production, this Public Key is hardcoded and the Private Key is kept offline in a cold vault by Vishnu.
const VARDHAN_MASTER_PUBLIC_KEY: [u8; 32] = [
    70, 189, 140, 148, 118, 160, 113, 130, 96, 10, 123, 200, 57, 174, 188, 189,
    209, 89, 201, 82, 77, 60, 147, 22, 37, 150, 46, 75, 28, 103, 176, 30,
];

#[derive(Serialize, Deserialize, Debug)]
pub struct EnterpriseLicense {
    pub tenant_id: String,
    pub valid_until: u64,
    pub max_nodes: u32,
    pub signature: String, // Hex encoded Ed25519 signature
}

pub fn verify_commercial_license(license_path: &str, current_tenant: &str) -> Result<(), &'static str> {
    let license_data = fs::read_to_string(license_path).map_err(|_| "CRITICAL: No vardhan.lic file found. Enterprise License required for production boot.")?;
    
    let license: EnterpriseLicense = serde_json::from_str(&license_data).map_err(|_| "CRITICAL: License file corrupted or invalid format.")?;
    
    // 1. Verify Tenant Match
    if license.tenant_id != current_tenant {
        return Err("CRITICAL: License tenant mismatch. This license belongs to another organization.");
    }
    
    // 2. Verify Expiry Date
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    if now > license.valid_until {
        return Err("CRITICAL: Enterprise License EXPIRED. The eBPF kernel shield has disarmed. Renew immediately.");
    }
    
    // 3. Cryptographic Signature Verification
    let pk = PublicKey::from_bytes(&VARDHAN_MASTER_PUBLIC_KEY).map_err(|_| "Internal Key Error")?;
    
    // Reconstruct the payload that was signed (tenant_id + valid_until + max_nodes)
    let payload = format!("{}:{}:{}", license.tenant_id, license.valid_until, license.max_nodes);
    
    let sig_bytes = hex::decode(&license.signature).map_err(|_| "Invalid signature encoding")?;
    if sig_bytes.len() != 64 { return Err("Invalid signature length"); }
    
    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(&sig_bytes);
    let signature = Signature::from_bytes(&sig_arr);
    
    if pk.verify(payload.as_bytes(), &signature).is_err() {
        return Err("CRITICAL: License signature verification failed. FORGERY DETECTED. System halted.");
    }
    
    Ok(())
}
