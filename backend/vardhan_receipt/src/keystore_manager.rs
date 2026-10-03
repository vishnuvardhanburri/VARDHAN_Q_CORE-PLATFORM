use std::path::PathBuf;
use std::sync::OnceLock;
use vardhan_keystore::VardhanKeystore;

static KEYSTORE: OnceLock<VardhanKeystore> = OnceLock::new();

pub fn init_keystore() {
    let keystore_dir = std::env::var("VARDHAN_KEYSTORE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp/vardhan_keystore_default"));

    let keystore = if keystore_dir.exists() && keystore_dir.join("keystore_meta.json").exists() {
        println!("🔐 Loading existing Q-Core signing keystore from {:?}", keystore_dir);
        VardhanKeystore::load_from_dir(&keystore_dir).expect("Failed to load existing keystore. Keystore may be corrupted.")
    } else {
        // First run initialization semantics
        println!("⚠️ No existing keystore found at {:?}. Generating a new persistent Q-Core signing identity.", keystore_dir);
        let ks = VardhanKeystore::generate();
        ks.save_to_dir(&keystore_dir).expect("Failed to persist new keystore");
        ks
    };

    KEYSTORE.set(keystore).unwrap_or_else(|_| panic!("Keystore already initialized"));
}

pub fn get_keystore() -> &'static VardhanKeystore {
    KEYSTORE.get().expect("Keystore not initialized. Call init_keystore() at startup.")
}
