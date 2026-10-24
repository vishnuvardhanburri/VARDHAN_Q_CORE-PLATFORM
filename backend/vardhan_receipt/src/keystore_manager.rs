use std::path::PathBuf;
use std::sync::OnceLock;
use vardhan_keystore::VardhanKeystore;

static KEYSTORE: OnceLock<VardhanKeystore> = OnceLock::new();

/// Initialize the Q-Core signing keystore.
///
/// In production (`VARDHAN_ENV=production`), this requires a configured
/// KMS/HSM-backed key protection provider. If no provider is configured,
/// initialization fails closed with a clear error.
///
/// In development (`VARDHAN_ENV=development` or unset), a local provider
/// with AES-256-GCM envelope encryption is used.
pub fn init_keystore() {
    if KEYSTORE.get().is_some() {
        return;
    }

    let keystore_dir = std::env::var("VARDHAN_KEYSTORE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp/vardhan_keystore_default"));

    // ── Environment enforcement (F-001) ──────────────────────────────────
    let env = std::env::var("VARDHAN_ENV").unwrap_or_else(|_| "development".to_string());
    let env_lower = env.to_lowercase();

    if env_lower == "production" || env_lower == "prod" {
        // Production: verify a production-safe key protection provider is available
        let kek_path = keystore_dir.join("dev_kek.bin");
        let provider_result = vardhan_keystore::EnvironmentKeyProtectionProvider::select(&kek_path);

        match provider_result {
            Ok(provider) => {
                if !provider.is_production_safe() {
                    panic!(
                        "FATAL: VARDHAN_ENV=production but key protection provider '{}' \
                         is not production-safe. Configure a certified HSM/KMS provider \
                         via VARDHAN_PRODUCTION_KEK (hex-encoded 32-byte KEK).",
                        provider.provider_name()
                    );
                }
                tracing::info!(
                    "Production keystore: using provider '{}'",
                    provider.provider_name()
                );
            }
            Err(e) => {
                panic!(
                    "FATAL: VARDHAN_ENV=production but no production-safe key protection \
                     provider is configured. Error: {}. \
                     Set VARDHAN_PRODUCTION_KEK (hex-encoded 32 bytes) and \
                     VARDHAN_KMS_PROVIDER to enable production key protection. \
                     Do not run with a development provider in production.",
                    e
                );
            }
        }
    } else {
        tracing::warn!(
            "VARDHAN_ENV={} — keystore initialized with development key protection. \
             Private keys are AES-256-GCM encrypted with a local KEK file. \
             NOT safe for production.",
            env
        );
    }

    // Check if keystore metadata file exists in the directory.
    // We check specifically for keystore_meta.json rather than directory non-emptiness,
    // because other files (like auth_config.json) may reside in or alongside this directory.
    let is_populated = keystore_dir.join("keystore_meta.json").is_file();

    let keystore = if is_populated {
        tracing::info!(
            "Loading existing Q-Core signing keystore from {:?}",
            keystore_dir
        );
        match VardhanKeystore::load_from_dir(&keystore_dir) {
            Ok(ks) => ks,
            Err(e) => {
                // FAIL CLOSED: No silent fallback/ephemeral key generation if keystore is corrupted or partial.
                panic!("FATAL: Failed to load existing keystore at {:?}. Error: {}. Keystore may be corrupted or partially written. Refusing to fallback to ephemeral keys.", keystore_dir.display(), e);
            }
        }
    } else {
        // First run initialization semantics
        tracing::warn!(
            "No existing keystore found at {:?}. Generating a new persistent Q-Core signing identity.",
            keystore_dir.display()
        );
        let ks = VardhanKeystore::generate();
        ks.save_to_dir(&keystore_dir)
            .expect("FATAL: Failed to persist new keystore");
        ks
    };

    let _ = KEYSTORE.set(keystore);
}

pub fn get_keystore() -> &'static VardhanKeystore {
    KEYSTORE
        .get()
        .expect("Keystore not initialized. Call init_keystore() at startup.")
}
