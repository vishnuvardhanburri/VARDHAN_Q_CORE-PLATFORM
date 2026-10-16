#![cfg(feature = "vault")]

//! G4 Vault/KMS binding + rotation drill (integration test).
//!
//! Binds `VardhanKeystore` to the genuine HashiCorp Vault transit engine,
//! rotates the transit KEK, and proves old signatures still verify while new
//! wraps use the rotated key version.
//!
//! Requires env (set by `scripts/g4_vault_rotation_drill.sh`, never printed):
//! - `VARDHAN_VAULT_ADDR`, `VARDHAN_VAULT_TOKEN`
//! - `VARDHAN_VAULT_KEY_NAME` (optional, default `vardhan-v1`)
//!
//! Skips gracefully (early return) when Vault env is unset so default
//! feature builds stay green. Prints key names and byte lengths only —
//! NEVER tokens, plaintext keys, or ciphertext blobs.

use ed25519_dalek::{Signature, Verifier};
use pqcrypto_traits::sign::DetachedSignature as _;
use std::convert::TryFrom;
use std::time::Duration;
use vardhan_keystore::{KeyProtectionProvider, VardhanKeystore, VaultKeyProtectionProvider};

/// Parse the `vault:v<N>:` envelope version from raw transit ciphertext bytes.
fn transit_version(blob: &[u8]) -> u32 {
    let s = std::str::from_utf8(blob).expect("transit ciphertext must be UTF-8");
    let rest = s
        .strip_prefix("vault:v")
        .expect("transit envelope prefix `vault:v`");
    let end = rest.find(':').expect("transit envelope version terminator");
    rest[..end]
        .parse::<u32>()
        .expect("transit envelope version number")
}

/// Restores an env var on drop so a mid-test failure cannot leak a bad token.
struct EnvRestoreGuard {
    key: &'static str,
    original: Option<String>,
}

impl EnvRestoreGuard {
    fn take(key: &'static str) -> Self {
        let original = std::env::var(key).ok();
        Self { key, original }
    }
}

impl Drop for EnvRestoreGuard {
    fn drop(&mut self) {
        unsafe {
            match &self.original {
                Some(v) => std::env::set_var(self.key, v),
                None => std::env::remove_var(self.key),
            }
        }
    }
}

#[test]
fn vault_kek_rotation_drill() {
    let addr = std::env::var("VARDHAN_VAULT_ADDR").unwrap_or_default();
    let token = std::env::var("VARDHAN_VAULT_TOKEN").unwrap_or_default();
    if addr.is_empty() || token.is_empty() {
        eprintln!("SKIP vault_rotation_drill: VARDHAN_VAULT_ADDR/_TOKEN not set");
        return;
    }
    let key_name = VaultKeyProtectionProvider::vault_key_name();
    let addr_norm = addr.trim_end_matches('/').to_string();

    // Provider binding assertions (name only — no secrets).
    let provider = VaultKeyProtectionProvider;
    assert!(VaultKeyProtectionProvider::configured());
    assert_eq!(provider.provider_name(), "vault-transit");
    assert!(provider.is_production_safe());
    eprintln!("WRAP-V1: provider=vault-transit key={key_name}");

    // Same keystore instance is wrapped before AND after rotation: this drill
    // rotates the Vault transit KEK (data-plane), not the keystore data keys.
    let ks = VardhanKeystore::generate();
    let dir_a = tempfile::tempdir().expect("tempdir A");
    ks.save_to_dir_with_provider(dir_a.path(), &provider)
        .expect("wrap dir A (transit v1)");

    let enc_a = std::fs::read(dir_a.path().join("ed25519.key.enc")).expect("ed25519.key.enc A");
    let mldsa_a = std::fs::read(dir_a.path().join("mldsa87.sec.enc")).expect("mldsa87.sec.enc A");
    assert!(
        enc_a.starts_with(b"vault:v"),
        "expected Vault transit envelope"
    );
    let v_a = transit_version(&enc_a);
    eprintln!(
        "WRAP-V1 OK: key={key_name} transit_version={v_a} enc_len={} mldsa_enc_len={}",
        enc_a.len(),
        mldsa_a.len()
    );

    // Baseline signatures (pre-rotation).
    let payload = b"g4-vault-rotation-drill-payload";
    let sig_a = ks.sign_ed25519(payload);
    let sig_bytes = hex::decode(&sig_a.signature_hex).expect("ed25519 sig hex");
    assert_eq!(sig_bytes.len(), 64, "ed25519 signature length");
    let sig_obj = Signature::try_from(sig_bytes.as_slice()).expect("ed25519 signature parse");
    ks.ed25519_public_key()
        .verify(payload, &sig_obj)
        .expect("ed25519 baseline verify");
    let mldsa_a_sig = ks.sign_mldsa87(payload);
    let mldsa_bytes = hex::decode(&mldsa_a_sig.signature_hex).expect("mldsa sig hex");
    let mldsa_obj = pqcrypto_mldsa::mldsa87::DetachedSignature::from_bytes(&mldsa_bytes)
        .expect("mldsa signature parse");
    assert!(
        pqcrypto_mldsa::mldsa87::verify_detached_signature(
            &mldsa_obj,
            payload,
            ks.mldsa87_public_key()
        )
        .is_ok(),
        "mldsa baseline verify"
    );

    // Rotate the transit KEK via the Vault HTTP API.
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("http client");
    let rotate_url = format!("{addr_norm}/v1/transit/keys/{key_name}/rotate");
    let resp = client
        .post(&rotate_url)
        .header("X-Vault-Token", &token)
        .json(&serde_json::json!({}))
        .send()
        .expect("rotate request");
    assert!(
        resp.status().is_success(),
        "rotate failed with status {}",
        resp.status()
    );
    let info: serde_json::Value = client
        .get(format!("{addr_norm}/v1/transit/keys/{key_name}"))
        .header("X-Vault-Token", &token)
        .send()
        .expect("key info request")
        .json()
        .expect("key info json");
    let latest = info
        .get("data")
        .and_then(|d| d.get("latest_version"))
        .and_then(|v| v.as_u64())
        .expect("latest_version") as u32;
    assert!(latest >= 2, "expected rotated key (latest_version>=2)");
    assert!(latest >= v_a, "rotation must not go backwards");
    eprintln!("ROTATE OK: key={key_name} latest_version={latest}");

    // Re-wrap with the same keystore instance — must use the new KEK version.
    let dir_b = tempfile::tempdir().expect("tempdir B");
    ks.save_to_dir_with_provider(dir_b.path(), &provider)
        .expect("rewrap dir B (transit v2)");
    let enc_b = std::fs::read(dir_b.path().join("ed25519.key.enc")).expect("ed25519.key.enc B");
    let v_b = transit_version(&enc_b);
    assert!(
        v_b > v_a,
        "rotation must advance transit version ({v_a} -> {v_b})"
    );
    assert_ne!(enc_a, enc_b, "rewrapped ciphertext must differ");
    eprintln!(
        "REWRAP-V2 OK: key={key_name} transit_version={v_a}->{v_b} enc_len={}",
        enc_b.len()
    );

    // Load dir B and prove continuity: old signature still validates with the
    // loaded pubkey; fresh sign/verify roundtrips work for both algorithms.
    let ks_b =
        VardhanKeystore::load_from_dir_with_provider(dir_b.path(), &provider).expect("load dir B");
    assert_eq!(
        ks.ed25519_identity().key_id,
        ks_b.ed25519_identity().key_id,
        "ed25519 identity continuity"
    );
    assert_eq!(
        ks.mldsa87_identity().key_id,
        ks_b.mldsa87_identity().key_id,
        "mldsa identity continuity"
    );
    ks_b.ed25519_public_key()
        .verify(payload, &sig_obj)
        .expect("pre-rotation signature verifies after load");
    let fresh = ks_b.sign_ed25519(payload);
    let fresh_bytes = hex::decode(&fresh.signature_hex).expect("fresh sig hex");
    let fresh_obj = Signature::try_from(fresh_bytes.as_slice()).expect("fresh sig parse");
    ks_b.ed25519_public_key()
        .verify(payload, &fresh_obj)
        .expect("post-rotation ed25519 roundtrip");
    let fresh_m = ks_b.sign_mldsa87(payload);
    let fresh_m_bytes = hex::decode(&fresh_m.signature_hex).expect("fresh mldsa hex");
    let fresh_m_obj = pqcrypto_mldsa::mldsa87::DetachedSignature::from_bytes(&fresh_m_bytes)
        .expect("fresh mldsa parse");
    assert!(
        pqcrypto_mldsa::mldsa87::verify_detached_signature(
            &fresh_m_obj,
            payload,
            ks_b.mldsa87_public_key()
        )
        .is_ok(),
        "post-rotation mldsa roundtrip"
    );
    eprintln!("LOAD+VERIFY OK: key={key_name}");

    // Failure case: wrong token must surface Err (no panic), then recovery.
    let _guard = EnvRestoreGuard::take("VARDHAN_VAULT_TOKEN");
    unsafe { std::env::set_var("VARDHAN_VAULT_TOKEN", "invalid-drill-token") };
    assert!(
        provider.wrap_private_key(b"drill-probe").is_err(),
        "wrap with wrong token must return Err"
    );
    eprintln!("BAD-TOKEN-ERR OK: key={key_name}");
    drop(_guard);
    // Guard restored the real token; prove recovery with a fresh wrap.
    assert!(
        provider.wrap_private_key(b"drill-probe").is_ok(),
        "wrap after token restore must succeed"
    );
    eprintln!("RECOVERY OK: key={key_name}");
    eprintln!("DRILL PASS: key={key_name}");
}
