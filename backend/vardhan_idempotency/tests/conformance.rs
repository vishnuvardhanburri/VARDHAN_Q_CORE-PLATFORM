//! Phase 2 conformance suite: common idempotency contract for EACH backend.
//!
//! Contract under test:
//!   1. duplicate-submission: second `check_and_register` with the same
//!      (tenant, key) inside the window is rejected and reports the
//!      original transaction id.
//!   2. concurrent-duplicate: N racing submissions for the same
//!      (tenant, key) yield exactly 1 accept + (N-1) duplicates
//!      (single-process, OS-file-lock serialized for durable;
//!      mutex-serialized for in-memory).
//!   3. restart-persistence (durable only): a record survives drop+reopen
//!      of the registry against the same path; in-memory is volatile by
//!      design and is NOT restart-persistent.
//!
//! Single-process restriction: the durable adapter serializes writers with
//! an OS lock file on one machine/filesystem. Multi-node replay protection
//! requires a shared strongly-consistent filesystem or a transactional DB
//! adapter (see `src/durable.rs` docs). NOT claimed here.
//!
//! Deps: std only + the crate itself (no tokio in Cargo.toml, so
//! `std::thread` is used instead of async tasks).

use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use vardhan_idempotency::durable::DurableIdempotencyRegistry;
use vardhan_idempotency::{IdempotencyKey, IdempotencyRegistry};

// ---------------------------------------------------------------------------
// Shared backend abstraction (one trait, both backends)
// ---------------------------------------------------------------------------

/// Unified outcome: `Ok(())` = accepted, `Err(original_tx)` = duplicate.
/// I/O / lock errors panic (fail the test) — they are not contract outcomes.
trait Backend: Sync + Send {
    fn register(
        &self,
        tenant: &str,
        key: &IdempotencyKey,
        tx: &str,
        window_ms: u64,
    ) -> Result<(), String>;
}

/// In-memory backend behind a Mutex so concurrent threads serialize,
/// mirroring how a real server would guard the `&mut self` registry.
struct MemBackend(Mutex<IdempotencyRegistry>);

impl MemBackend {
    fn new() -> Self {
        Self(Mutex::new(IdempotencyRegistry::new()))
    }
}

impl Backend for MemBackend {
    fn register(
        &self,
        tenant: &str,
        key: &IdempotencyKey,
        tx: &str,
        window_ms: u64,
    ) -> Result<(), String> {
        let mut guard = self.0.lock().expect("mem backend mutex poisoned");
        guard
            .check_and_register(tenant, key, tx, window_ms)
            .map_err(|dup| dup.original_transaction_id)
    }
}

/// Durable backend wrapper (already `&self`-safe via OS lock file).
struct DurableBackend(DurableIdempotencyRegistry);

impl Backend for DurableBackend {
    fn register(
        &self,
        tenant: &str,
        key: &IdempotencyKey,
        tx: &str,
        window_ms: u64,
    ) -> Result<(), String> {
        self.0
            .check_and_register(tenant, key, tx, window_ms)
            .expect("durable backend I/O or lock failure")
            .map_err(|dup| dup.original_transaction_id)
    }
}

// ---------------------------------------------------------------------------
// Shared contract assertions (generic over Backend)
// ---------------------------------------------------------------------------

/// Rule 1: duplicate submission rejected, original tx id reported.
fn assert_duplicate_submission(backend: &impl Backend, label: &str) {
    let key = IdempotencyKey::new("conformance-dup-key");
    backend
        .register("tenant-conformance", &key, "tx-first", 60_000)
        .unwrap_or_else(|_| panic!("{label}: first registration must be accepted"));
    let dup = backend
        .register("tenant-conformance", &key, "tx-second", 60_000)
        .expect_err(&format!("{label}: duplicate submission must be rejected"));
    assert_eq!(
        dup, "tx-first",
        "{label}: duplicate must report original tx id"
    );
}

/// Rule 1b: tenant isolation — same key under a different tenant is accepted.
fn assert_tenant_isolation(backend: &impl Backend, label: &str) {
    let key = IdempotencyKey::new("conformance-tenant-key");
    backend
        .register("tenant-a", &key, "tx-a", 60_000)
        .unwrap_or_else(|_| panic!("{label}: tenant-a registration must be accepted"));
    backend
        .register("tenant-b", &key, "tx-b", 60_000)
        .unwrap_or_else(|_| panic!("{label}: same key under tenant-b must be accepted"));
}

/// Rule 2: concurrent duplicates — exactly one winner (std threads; no tokio dep).
fn assert_concurrent_duplicate<B: Backend>(backend: &B, label: &str) {
    const RACERS: usize = 8;
    std::thread::scope(|scope| {
        let key = IdempotencyKey::new("conformance-race-key");
        let handles: Vec<_> = (0..RACERS)
            .map(|i| {
                let key_clone = key.clone();
                scope.spawn(move || {
                    let tx = format!("tx-racer-{i}");
                    backend.register("tenant-race", &key_clone, &tx, 60_000)
                })
            })
            .collect();
        let mut accepted = 0usize;
        let mut duplicates = 0usize;
        for handle in handles {
            match handle.join().expect("racer thread panicked") {
                Ok(()) => accepted += 1,
                Err(_) => duplicates += 1,
            }
        }
        assert_eq!(accepted, 1, "{label}: exactly one racer must be accepted");
        assert_eq!(
            duplicates,
            RACERS - 1,
            "{label}: all other racers must see duplicate"
        );
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static CONFORMANCE_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn temp_path(tag: &str) -> std::path::PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_nanos();
    let seq = CONFORMANCE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    std::env::temp_dir().join(format!(
        "vardhan-idempotency-conformance-{tag}-{stamp}-{seq}-{}.json",
        std::process::id()
    ))
}

fn cleanup_durable_files(path: &std::path::Path) {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(path.with_extension("lock"));
    let _ = std::fs::remove_file(path.with_extension("state.tmp"));
}

// ---------------------------------------------------------------------------
// Conformance cases: EACH backend runs the shared assertions
// ---------------------------------------------------------------------------

#[test]
fn conformance_inmem_duplicate_submission() {
    let backend = MemBackend::new();
    assert_duplicate_submission(&backend, "inmem");
}

#[test]
fn conformance_inmem_tenant_isolation() {
    let backend = MemBackend::new();
    assert_tenant_isolation(&backend, "inmem");
}

#[test]
fn conformance_inmem_concurrent_duplicate() {
    let backend = MemBackend::new();
    assert_concurrent_duplicate(&backend, "inmem");
}

#[test]
fn conformance_durable_duplicate_submission() {
    let path = temp_path("dup");
    let backend = DurableBackend(DurableIdempotencyRegistry::new(&path));
    assert_duplicate_submission(&backend, "durable");
    cleanup_durable_files(&path);
}

#[test]
fn conformance_durable_tenant_isolation() {
    let path = temp_path("tenant");
    let backend = DurableBackend(DurableIdempotencyRegistry::new(&path));
    assert_tenant_isolation(&backend, "durable");
    cleanup_durable_files(&path);
}

#[test]
fn conformance_durable_concurrent_duplicate() {
    let path = temp_path("race");
    let backend = Arc::new(DurableBackend(DurableIdempotencyRegistry::new(&path)));
    // Arc-shared racing threads against ONE durable path (OS lock serializes).
    std::thread::scope(|scope| {
        const RACERS: usize = 8;
        let key = IdempotencyKey::new("conformance-race-key");
        let handles: Vec<_> = (0..RACERS)
            .map(|i| {
                let backend = Arc::clone(&backend);
                let key_clone = key.clone();
                scope.spawn(move || {
                    let tx = format!("tx-racer-{i}");
                    backend.register("tenant-race", &key_clone, &tx, 60_000)
                })
            })
            .collect();
        let mut accepted = 0usize;
        let mut duplicates = 0usize;
        for handle in handles {
            match handle.join().expect("racer thread panicked") {
                Ok(()) => accepted += 1,
                Err(_) => duplicates += 1,
            }
        }
        assert_eq!(accepted, 1, "durable: exactly one racer must be accepted");
        assert_eq!(duplicates, RACERS - 1, "durable: rest must see duplicate");
    });
    cleanup_durable_files(&path);
}

#[test]
fn conformance_durable_restart_persistence() {
    // Durable-only rule: record survives drop + reopen on the same path.
    let path = temp_path("restart");
    let key = IdempotencyKey::new("conformance-restart-key");
    {
        let first = DurableIdempotencyRegistry::new(&path);
        first
            .check_and_register("tenant-restart", &key, "tx-original", 60_000)
            .expect("durable I/O failure")
            .expect("first registration must be accepted");
    } // drop ~ simulated restart
    {
        let reopened = DurableIdempotencyRegistry::new(&path);
        let dup = reopened
            .check_and_register("tenant-restart", &key, "tx-replay", 60_000)
            .expect("durable I/O failure")
            .expect_err("replay after restart must be rejected");
        assert_eq!(dup.original_transaction_id, "tx-original");
    }
    cleanup_durable_files(&path);
}
