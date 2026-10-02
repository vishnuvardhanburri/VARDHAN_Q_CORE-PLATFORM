//! # pq_verify
//!
//! Standalone, independently operable audit verifier for Vardhan Quantum Proxy.
//!
//! Takes an exported evidence bundle and cryptographically verifies:
//!   1. Sequence integrity — monotonic, gapless
//!   2. Chain integrity — each entry's prev_hash == BLAKE3(canonical(prev_entry))
//!   3. Signature integrity — ML-DSA-87 sig over canonical hash holds for every entry
//!
//! Has zero dependency on pq_shield or TelemetryEngine.
//! Needs only: the evidence package directory and the ML-DSA-87 public key.
//!
//! ## Usage
//! ```
//! pq_verify --evidence-dir /path/to/export --public-key /path/to/public_key.hex
//! ```
//!
//! ## Exit codes
//!   0 = PASS
//!   1 = FAIL (cryptographic failure or structural violation)
//!   2 = Usage / IO error

use audit_ledger::{canonical_hash, merkle_root_from_hashes, CommittedCheckpoint, LedgerEntry};
use clap::Parser;
use core_crypto::QuantumNodeIdentity;
use serde::Serialize;
use std::io::BufRead;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(
    name = "pq_verify",
    about = "Independently verify a Vardhan Quantum Proxy audit evidence bundle",
    long_about = None
)]
struct Args {
    /// Path to the exported evidence directory
    #[arg(long)]
    evidence_dir: PathBuf,

    /// Path to the hex-encoded ML-DSA-87 public key file (public_key.hex)
    #[arg(long)]
    public_key: Option<PathBuf>,
}

#[derive(Debug, Serialize)]
struct VerificationReport {
    verdict: &'static str,
    entries_verified: u64,
    chain_integrity: &'static str,
    signature_integrity: &'static str,
    sequence_integrity: &'static str,
    first_seq: Option<u64>,
    last_seq: Option<u64>,
    tip_hash: String,
    checkpoints_verified: u64,
    checkpoint_chain_integrity: &'static str,
    checkpoint_signature_integrity: &'static str,
    checkpoint_merkle_root: &'static str,
    checkpoint_raft_binding: &'static str,
    failures: Vec<String>,
}

fn main() {
    let args = Args::parse();
    let report = run_verification(&args);
    match serde_json::to_string_pretty(&report) {
        Ok(json) => println!("{}", json),
        Err(e) => {
            eprintln!("Failed to serialize verification report: {e}");
            std::process::exit(2);
        }
    }
    std::process::exit(if report.verdict == "PASS" { 0 } else { 1 });
}

fn run_verification(args: &Args) -> VerificationReport {
    let mut failures: Vec<String> = Vec::new();

    // ─── Load public key ──────────────────────────────────────────────────────
    let pub_key_path = args
        .public_key
        .clone()
        .unwrap_or_else(|| args.evidence_dir.join("public_key.hex"));

    let pub_key_bytes = match load_public_key(&pub_key_path) {
        Ok(b) => b,
        Err(e) => {
            return VerificationReport {
                verdict: "FAIL",
                entries_verified: 0,
                chain_integrity: "UNKNOWN",
                signature_integrity: "UNKNOWN",
                sequence_integrity: "UNKNOWN",
                first_seq: None,
                last_seq: None,
                tip_hash: String::new(),
                checkpoints_verified: 0,
                checkpoint_chain_integrity: "UNKNOWN",
                checkpoint_signature_integrity: "UNKNOWN",
                checkpoint_merkle_root: "UNKNOWN",
                checkpoint_raft_binding: "UNKNOWN",
                failures: vec![format!("Cannot load public key: {e}")],
            };
        }
    };

    // Compute expected fingerprint from supplied public key
    let expected_fingerprint = hex::encode(QuantumNodeIdentity::hash_ledger_block(&pub_key_bytes));

    // ─── Load ledger file ─────────────────────────────────────────────────────
    let ledger_path = args.evidence_dir.join("ledger.jsonl");
    let content = match std::fs::read_to_string(&ledger_path) {
        Ok(c) => c,
        Err(e) => {
            return VerificationReport {
                verdict: "FAIL",
                entries_verified: 0,
                chain_integrity: "UNKNOWN",
                signature_integrity: "UNKNOWN",
                sequence_integrity: "UNKNOWN",
                first_seq: None,
                last_seq: None,
                tip_hash: String::new(),
                checkpoints_verified: 0,
                checkpoint_chain_integrity: "UNKNOWN",
                checkpoint_signature_integrity: "UNKNOWN",
                checkpoint_merkle_root: "UNKNOWN",
                checkpoint_raft_binding: "UNKNOWN",
                failures: vec![format!("Cannot read ledger.jsonl: {e}")],
            };
        }
    };

    // ─── Verify each entry ────────────────────────────────────────────────────
    let mut prev_hash = [0u8; 32];
    let mut last_seq: Option<u64> = None;
    let mut entries_verified: u64 = 0;
    let mut chain_ok = true;
    let mut sig_ok = true;
    let mut seq_ok = true;
    let mut tip_hash = String::from("0".repeat(64));

    for (line_no, line) in content.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }

        // 1. Parse
        let entry: LedgerEntry = match serde_json::from_str(line) {
            Ok(e) => e,
            Err(e) => {
                failures.push(format!("Line {line_no}: JSON parse error: {e}"));
                chain_ok = false;
                seq_ok = false;
                continue;
            }
        };

        // 2. Sequence check
        match last_seq {
            None if entry.seq != 0 => {
                failures.push(format!(
                    "Line {line_no}: expected seq=0 as first entry, got seq={}",
                    entry.seq
                ));
                seq_ok = false;
            }
            Some(s) if entry.seq != s + 1 => {
                failures.push(format!(
                    "Line {line_no}: sequence gap — expected seq={}, got seq={}",
                    s + 1,
                    entry.seq
                ));
                seq_ok = false;
            }
            _ => {}
        }

        // 3. Public key fingerprint check (verify against every entry for consistency)
        if entry.signer_pub_fingerprint != expected_fingerprint {
            failures.push(format!(
                "seq={}: signer fingerprint mismatch — entry has {}, expected {}",
                entry.seq, entry.signer_pub_fingerprint, expected_fingerprint
            ));
            sig_ok = false;
        }

        // 4. Chain integrity: entry.prev_hash must equal BLAKE3(canonical(prev_entry))
        let expected_prev_hex = hex::encode(prev_hash);
        if entry.prev_hash != expected_prev_hex {
            failures.push(format!(
                "seq={}: chain break — expected prev_hash={}, got={}",
                entry.seq, expected_prev_hex, entry.prev_hash
            ));
            chain_ok = false;
        }

        // 5. Recompute canonical hash and verify signature
        let event_json = serde_json::to_string(&entry.event).expect("event must be serializable");
        let prev_hash_bytes = match hex::decode(&entry.prev_hash) {
            Ok(b) => b,
            Err(e) => {
                failures.push(format!("seq={}: invalid prev_hash hex: {e}", entry.seq));
                chain_ok = false;
                continue;
            }
        };
        let canonical =
            canonical_hash(entry.seq, entry.timestamp_ms, &event_json, &prev_hash_bytes);

        let sig_bytes = match hex::decode(&entry.signature) {
            Ok(b) => b,
            Err(e) => {
                failures.push(format!("seq={}: invalid signature hex: {e}", entry.seq));
                sig_ok = false;
                continue;
            }
        };

        if !QuantumNodeIdentity::verify_signature(&pub_key_bytes, &canonical, &sig_bytes) {
            failures.push(format!("seq={}: ML-DSA-87 signature INVALID", entry.seq));
            sig_ok = false;
        }

        // Advance chain state
        prev_hash = entry.canonical_hash().expect("Canonical hash failed");
        tip_hash = hex::encode(prev_hash);
        last_seq = Some(entry.seq);
        entries_verified += 1;
    }

    // ─── Verify checkpoints (P7.3) ───────────────────────────────────────────
    let checkpoint_path = args.evidence_dir.join("checkpoints.jsonl");
    let (cp_verified, cp_chain_ok, cp_sig_ok, cp_merkle_ok, cp_raft_ok) = verify_checkpoints(
        &checkpoint_path,
        &ledger_path,
        &pub_key_bytes,
        &mut failures,
    );

    // ─── Determine verdict ───────────────────────────────────────────────────
    let has_evidence = entries_verified > 0 || cp_verified > 0;
    if !has_evidence && failures.is_empty() {
        failures.push("No ledger entries and no checkpoints found".to_string());
    }
    let verdict = if failures.is_empty() && has_evidence {
        "PASS"
    } else {
        "FAIL"
    };

    VerificationReport {
        verdict,
        entries_verified,
        chain_integrity: if chain_ok { "PASS" } else { "FAIL" },
        signature_integrity: if sig_ok { "PASS" } else { "FAIL" },
        sequence_integrity: if seq_ok { "PASS" } else { "FAIL" },
        first_seq: if entries_verified > 0 { Some(0) } else { None },
        last_seq,
        tip_hash,
        checkpoints_verified: cp_verified,
        checkpoint_chain_integrity: if cp_chain_ok { "PASS" } else { "FAIL" },
        checkpoint_signature_integrity: if cp_sig_ok { "PASS" } else { "FAIL" },
        checkpoint_merkle_root: if cp_merkle_ok { "PASS" } else { "FAIL" },
        checkpoint_raft_binding: if cp_raft_ok { "PASS" } else { "FAIL" },
        failures,
    }
}

/// Verify the checkpoint chain against the ledger.
///
/// Checks performed for each checkpoint:
/// 1. ML-DSA-87 signature validity
/// 2. Canonical encoding round-trip (recompute hash)
/// 3. Checkpoint hash (BLAKE3 of canonical || signature)
/// 4. Previous checkpoint hash linkage (chain integrity)
/// 5. Ledger sequence range coverage (first_seq..=last_seq is contiguous)
/// 6. Merkle root matches ledger entries in the covered range
/// 7. Raft term/index binding (term and index are monotonically increasing,
///    and index > entry count proves the checkpoint was committed after the
///    ledger entries)
///
/// Returns: (checkpoints_verified, chain_ok, sig_ok, merkle_ok, raft_ok)
fn verify_checkpoints(
    checkpoint_path: &std::path::Path,
    ledger_path: &std::path::Path,
    pub_key_bytes: &[u8],
    failures: &mut Vec<String>,
) -> (u64, bool, bool, bool, bool) {
    let content = match std::fs::read_to_string(checkpoint_path) {
        Ok(c) => c,
        Err(_) => {
            // No checkpoints file — not a failure, just no checkpoints to verify
            return (0, true, true, true, true);
        }
    };

    // Load all ledger entries for Merkle root verification
    let ledger_hashes: Vec<Vec<u8>> = {
        let file = match std::fs::File::open(ledger_path) {
            Ok(f) => f,
            Err(e) => {
                failures.push(format!(
                    "Cannot open ledger for checkpoint Merkle verification: {e}"
                ));
                return (0, false, false, false, false);
            }
        };
        let reader = std::io::BufReader::new(file);
        let mut hashes = Vec::new();
        for line_res in reader.lines() {
            let line = line_res.unwrap_or_default();
            if line.trim().is_empty() {
                continue;
            }
            let entry: LedgerEntry = match serde_json::from_str(&line) {
                Ok(e) => e,
                Err(_) => continue,
            };
            // FIX: Use the full canonical hash as the Merkle leaf.
            // This binds seq, timestamp, event, and prev_hash into the Merkle root.
            hashes.push(
                entry
                    .canonical_hash()
                    .expect("Canonical hash failed")
                    .to_vec(),
            );
        }
        hashes
    };

    let mut prev_checkpoint_hash = [0u8; 32];
    let mut checkpoints_verified: u64 = 0;
    let mut chain_ok = true;
    let mut sig_ok = true;
    let mut merkle_ok = true;
    let mut raft_ok = true;
    let mut last_raft_term: u64 = 0;
    let mut last_raft_index: u64 = 0;

    for (line_no, line) in content.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }

        let cp: CommittedCheckpoint = match serde_json::from_str(line) {
            Ok(c) => c,
            Err(e) => {
                failures.push(format!("Checkpoint line {line_no}: JSON parse error: {e}"));
                chain_ok = false;
                sig_ok = false;
                merkle_ok = false;
                raft_ok = false;
                continue;
            }
        };

        // 1. Verify previous checkpoint hash linkage (chain integrity)
        let expected_prev = hex::encode(prev_checkpoint_hash);
        if cp.checkpoint.previous_checkpoint_hash != expected_prev {
            failures.push(format!(
                "Checkpoint line {line_no}: chain break — expected prev={}, got={}",
                expected_prev, cp.checkpoint.previous_checkpoint_hash
            ));
            chain_ok = false;
        }

        // 2. Verify ML-DSA-87 signature
        let canonical = match cp.checkpoint.canonical_hash() {
            Ok(h) => h,
            Err(e) => {
                failures.push(format!(
                    "Checkpoint line {line_no}: canonical hash computation failed: {e}"
                ));
                sig_ok = false;
                continue;
            }
        };
        let sig_bytes = match hex::decode(&cp.checkpoint.signature) {
            Ok(b) => b,
            Err(e) => {
                failures.push(format!(
                    "Checkpoint line {line_no}: invalid signature hex: {e}"
                ));
                sig_ok = false;
                continue;
            }
        };
        if !QuantumNodeIdentity::verify_signature(pub_key_bytes, &canonical, &sig_bytes) {
            failures.push(format!(
                "Checkpoint line {line_no}: ML-DSA-87 signature INVALID"
            ));
            sig_ok = false;
        }

        // 3. Verify signer fingerprint
        let expected_fp = hex::encode(QuantumNodeIdentity::hash_ledger_block(pub_key_bytes));
        if cp.checkpoint.signer_pub_fingerprint != expected_fp {
            failures.push(format!(
                "Checkpoint line {line_no}: signer fingerprint mismatch — expected {}, got {}",
                expected_fp, cp.checkpoint.signer_pub_fingerprint
            ));
            sig_ok = false;
        }

        // 4. Verify checkpoint hash (BLAKE3 of canonical || signature)
        let expected_cp_hash = match cp.checkpoint.checkpoint_hash() {
            Ok(h) => h,
            Err(e) => {
                failures.push(format!(
                    "Checkpoint line {line_no}: checkpoint hash computation failed: {e}"
                ));
                chain_ok = false;
                continue;
            }
        };

        // 5. Verify Merkle root matches ledger entries in the covered range
        let first = cp.checkpoint.ledger_first_seq as usize;
        let last = cp.checkpoint.ledger_last_seq as usize;
        let count = cp.checkpoint.ledger_entry_count;
        if last >= ledger_hashes.len() {
            failures.push(format!(
                "Checkpoint line {line_no}: ledger range [{}, {}] exceeds ledger entries ({})",
                first,
                last,
                ledger_hashes.len()
            ));
            merkle_ok = false;
        } else if count != (last.saturating_sub(first).saturating_add(1)) as u64 {
            failures.push(format!(
                "Checkpoint line {line_no}: ledger_entry_count ({}) != range size ({})",
                count,
                last.saturating_sub(first).saturating_add(1)
            ));
            merkle_ok = false;
        } else if first > last {
            failures.push(format!(
                "Checkpoint line {line_no}: invalid ledger range [{}, {}]",
                first, last
            ));
            merkle_ok = false;
        } else {
            let range_hashes: Vec<Vec<u8>> = ledger_hashes[first..=last].to_vec();
            let computed_merkle = merkle_root_from_hashes(&range_hashes);
            let stored_merkle = match hex::decode(&cp.checkpoint.merkle_root) {
                Ok(b) => b,
                Err(e) => {
                    failures.push(format!(
                        "Checkpoint line {line_no}: invalid merkle_root hex: {e}"
                    ));
                    merkle_ok = false;
                    continue;
                }
            };
            if computed_merkle.as_slice() != stored_merkle.as_slice() {
                failures.push(format!(
                    "Checkpoint line {line_no}: Merkle root mismatch — computed={:x?}, stored={:x?}",
                    computed_merkle, stored_merkle
                ));
                merkle_ok = false;
            }
        }

        // 6. Verify Raft term/index binding
        if cp.checkpoint.raft_term < last_raft_term {
            failures.push(format!(
                "Checkpoint line {line_no}: Raft term regression — prev={}, current={}",
                last_raft_term, cp.checkpoint.raft_term
            ));
            raft_ok = false;
        }
        if cp.checkpoint.raft_log_index < last_raft_index {
            failures.push(format!(
                "Checkpoint line {line_no}: Raft log index regression — prev={}, current={}",
                last_raft_index, cp.checkpoint.raft_log_index
            ));
            raft_ok = false;
        }
        // Raft commit index must be >= ledger entry count at the time of checkpoint
        // (the checkpoint was submitted as a Raft log entry AFTER the ledger entries)
        let ledger_len = ledger_hashes.len() as u64;
        if cp.checkpoint.raft_log_index < ledger_len {
            failures.push(format!(
                "Checkpoint line {line_no}: Raft log index ({}) < ledger entry count ({}) — checkpoint committed before ledger entries it covers",
                cp.checkpoint.raft_log_index, ledger_len
            ));
            raft_ok = false;
        }
        last_raft_term = cp.checkpoint.raft_term;
        last_raft_index = cp.checkpoint.raft_log_index;

        // Advance chain state
        prev_checkpoint_hash = expected_cp_hash;
        checkpoints_verified += 1;
    }

    (checkpoints_verified, chain_ok, sig_ok, merkle_ok, raft_ok)
}

fn load_public_key(path: &std::path::Path) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let hex_str = std::fs::read_to_string(path)?;
    let bytes = hex::decode(hex_str.trim())?;
    if bytes.len() != core_crypto::DSA_PUB_KEY_LEN {
        return Err(format!(
            "Public key must be {} bytes, got {}",
            core_crypto::DSA_PUB_KEY_LEN,
            bytes.len()
        )
        .into());
    }
    Ok(bytes)
}
