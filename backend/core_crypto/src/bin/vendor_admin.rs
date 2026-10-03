use ed25519_dalek::{Signer, SigningKey};
use rand::RngCore;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    let mut csprng = rand::thread_rng();
    let mut secret = [0u8; 32];
    csprng.fill_bytes(&mut secret);

    let signing_key = SigningKey::from_bytes(&secret);
    let verify_key = signing_key.verifying_key();

    println!("--- MASTER PUBLIC KEY (HARDCODE THIS IN license.rs) ---");
    println!("{:?}", verify_key.as_bytes());
    println!("-------------------------------------------------------\n");

    println!("--- MASTER PRIVATE KEY (KEEP THIS SECRET!) ---");
    println!("{:?}", secret);
    println!("----------------------------------------------\n");

    let tenant_id = "hsbc";
    let days_valid = 365;
    let max_nodes = 10;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let valid_until = now + (days_valid * 24 * 60 * 60);

    let payload = format!("{}:{}:{}", tenant_id, valid_until, max_nodes);

    let signature = signing_key.sign(payload.as_bytes());
    let sig_hex = hex::encode(signature.to_bytes());

    let license_json = format!(
        r#"{{
  "tenant_id": "{}",
  "valid_until": {},
  "max_nodes": {},
  "signature": "{}"
}}"#,
        tenant_id, valid_until, max_nodes, sig_hex
    );

    fs::write("vardhan.lic", &license_json).unwrap();
    println!(
        "SUCCESS: Generated 'vardhan.lic' for tenant '{}'!",
        tenant_id
    );
    println!("Payload Signed: {}", payload);
}
