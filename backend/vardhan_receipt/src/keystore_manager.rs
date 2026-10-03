use std::path::PathBuf;
use std::sync::OnceLock;
use std::fs;
use vardhan_keystore::VardhanKeystore;

static KEYSTORE: OnceLock<VardhanKeystore> = OnceLock::new();

pub fn init_keystore() {
    let keystore_dir = std::env::var("VARDHAN_KEYSTORE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp/vardhan_keystore_default"));

    // Check if the directory exists and has any contents
    let is_populated = if keystore_dir.exists() {
        match fs::read_dir(&keystore_dir) {
            Ok(mut entries) => entries.next().is_some(),
            Err(_) => false,
        }
    } else {
        false
    };

    let keystore = if is_populated {
        println!("🔐 Loading existing Q-Core signing keystore from {:?}", keystore_dir);
        match VardhanKeystore::load_from_dir(&keystore_dir) {
            Ok(ks) => ks,
            Err(e) => {
                // FAIL CLOSED: No silent fallback/ephemeral key generation if keystore is corrupted or partial.
                panic!("FATAL: Failed to load existing keystore at {:?}. Error: {}. Keystore may be corrupted or partially written. Refusing to fallback to ephemeral keys.", keystore_dir, e);
            }
        }
    } else {
        // First run initialization semantics
        println!("⚠️ No existing keystore found at {:?}. Generating a new persistent Q-Core signing identity.", keystore_dir);
        let ks = VardhanKeystore::generate();
        ks.save_to_dir(&keystore_dir).expect("FATAL: Failed to persist new keystore");
        ks
    };

    KEYSTORE.set(keystore).unwrap_or_else(|_| panic!("Keystore already initialized"));
}

pub fn get_keystore() -> &'static VardhanKeystore {
    KEYSTORE.get().expect("Keystore not initialized. Call init_keystore() at startup.")
}
