//! Machine-readable schema for the audit ledger evidence package.
//!
//! The schema JSON is included in every evidence export so that third-party
//! verifiers can reproduce canonical bytes without reading Rust source.

pub const SCHEMA_JSON: &str = r#"{
  "schema_version": 1,
  "description": "Vardhan Quantum Proxy — Audit Ledger Entry Schema v1",
  "ledger_format": "JSON Lines (.jsonl), one entry per line, UTF-8",
  "fields": {
    "schema_version": {
      "type": "u32",
      "description": "Always 1 for this schema version"
    },
    "seq": {
      "type": "u64",
      "description": "Monotonically increasing entry index, starting at 0"
    },
    "timestamp_ms": {
      "type": "u128",
      "description": "Unix epoch milliseconds at time of entry creation"
    },
    "prev_hash": {
      "type": "hex string",
      "length_bytes": 32,
      "description": "BLAKE3 hash of the canonical bytes of entry[seq-1]. For seq=0 (genesis), this is 32 zero bytes (64 hex zeros)."
    },
    "event": {
      "type": "object",
      "description": "QuantumEvent JSON object (see event_schema below)"
    },
    "signature": {
      "type": "hex string",
      "length_bytes": 4627,
      "description": "ML-DSA-87 (FIPS 204) signature over the canonical_hash bytes (not the raw entry JSON)"
    },
    "signer_pub_fingerprint": {
      "type": "hex string",
      "length_bytes": 32,
      "description": "BLAKE3 hash of the signer's ML-DSA-87 public key bytes (2592 bytes). Used to identify the correct public key from the evidence package."
    }
  },
  "canonical_bytes_spec": {
    "description": "The 32-byte BLAKE3 value that is both signed and chained. Reproducible by any BLAKE3 implementation.",
    "construction": "BLAKE3( seq_le64 || timestamp_ms_trunc_le64 || event_json_utf8 || prev_hash_bytes32 )",
    "fields": {
      "seq_le64": "seq field as u64, 8 bytes little-endian",
      "timestamp_ms_trunc_le64": "timestamp_ms field truncated to u64 (lower 64 bits), 8 bytes little-endian",
      "event_json_utf8": "The 'event' field serialized as compact JSON (no trailing whitespace), UTF-8 bytes",
      "prev_hash_bytes32": "The 'prev_hash' field decoded from hex to 32 raw bytes"
    }
  },
  "event_schema": {
    "schema_version": "u32",
    "event_id": "UUID v4 string",
    "timestamp_ms": "u128, Unix epoch ms",
    "session_id": "hex string, lower 8 bytes of ML-KEM session_id",
    "event_type": "string: HandshakeCompleted | UpstreamConnected | UpstreamFailed | SessionClosed",
    "sequence": "u64, per-session sequence counter",
    "payload": "object, event-type-specific data"
  },
  "chain_rules": {
    "genesis": "entry with seq=0 must have prev_hash = '0000...0000' (64 hex zeros)",
    "continuity": "entry[n].prev_hash == hex(BLAKE3(canonical_bytes(entry[n-1])))",
    "monotonic": "seq values must be 0, 1, 2, ... with no gaps"
  },
  "signature_algorithm": {
    "algorithm": "ML-DSA-87 (FIPS 204, formerly CRYSTALS-Dilithium level 5)",
    "signed_payload": "The 32-byte canonical BLAKE3 hash (not the full entry JSON)",
    "public_key_length_bytes": 2592,
    "signature_length_bytes": 4627,
    "context_string": "empty (zero-length byte string)"
  },
  "evidence_package_files": {
    "ledger.jsonl": "Complete ledger entries, one JSON object per line",
    "public_key.hex": "Hex-encoded ML-DSA-87 public key bytes (2592 bytes = 5184 hex chars)",
    "schema.json": "This file",
    "manifest.json": "Export metadata: timestamp, entry_count, tip_hash, schema_version, manifest_signature"
  },
  "verification_steps": [
    "1. Load public_key.hex, decode hex to 2592 bytes",
    "2. Verify public key fingerprint: BLAKE3(public_key_bytes) == first entry's signer_pub_fingerprint",
    "3. For each entry in order: verify seq is prev_seq+1 (or 0 for first)",
    "4. For each entry: decode prev_hash from hex; for seq=0 verify it is 32 zero bytes",
    "5. For each entry: compute canonical_hash from spec above",
    "6. For each entry: verify ML-DSA-87 signature over canonical_hash using public key",
    "7. For each entry[n] (n>=1): verify entry[n].prev_hash == hex(canonical_hash(entry[n-1]))",
    "8. Report PASS only if all checks pass with zero failures"
  ]
}"#;

/// Write the schema to a file path.
pub fn write_schema(path: &std::path::Path) -> std::io::Result<()> {
    std::fs::write(path, SCHEMA_JSON)
}
