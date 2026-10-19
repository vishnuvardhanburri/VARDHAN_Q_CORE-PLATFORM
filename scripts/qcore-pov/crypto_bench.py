#!/usr/bin/env python3
"""
VARDHAN Q-CORE — Cryptographic Microbenchmarks (PoV)

Measures signing/verification throughput for:
  - Ed25519 (PureEdDSA)
  - ML-DSA-87 (post-quantum, NIST algorithm)
  - BLAKE3 hashing

These are the cryptographic primitives used by the Q-Core receipt engine.
The benchmarks use the Python ed25519 and hashlib libraries for Ed25519/BLAKE3,
and invoke the vardhan-receipt binary for ML-DSA-87 (since ML-DSA libraries
are Rust-only). This isolates crypto performance from the HTTP/API layer.
"""
import json
import os
import sys
import time
import hashlib
import base64
import statistics
import subprocess
import tempfile
import shutil

# ─── Ed25519 via cryptography library ─────────────────────────
try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
    from cryptography.hazmat.primitives import serialization
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False

# ─── BLAKE3 ───────────────────────────────────────────────────
try:
    import blake3
    HAS_BLAKE3 = True
except ImportError:
    HAS_BLAKE3 = False

# ─── Configuration ────────────────────────────────────────────
RESULTS = {
    "ed25519": {},
    "mldsa87": {},
    "blake3": {},
    "qcore_integration": {},
}

def bench_ed25519():
    """Benchmark Ed25519 sign and verify operations."""
    if not HAS_CRYPTO:
        print("skipping ed25519 (cryptography library not available)")
        RESULTS["ed25519"]["error"] = "cryptography library not available"
        return

    print("\n--- Ed25519 Benchmarks ---")
    
    # Generate a key pair
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    
    # Serialize for standalone verification
    pub_pem = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw
    )
    
    payloads = {
        "1KB": b"x" * 1024,
        "10KB": b"x" * 10240,
        "100KB": b"x" * 102400,
    }
    
    iterations = 10000
    
    for size_name, payload in payloads.items():
        # Sign benchmark
        sign_times = []
        for _ in range(iterations):
            start = time.perf_counter_ns()
            signature = private_key.sign(payload)
            elapsed_us = (time.perf_counter_ns() - start) / 1000
            sign_times.append(elapsed_us)
        
        # Verify benchmark
        verify_times = []
        for _ in range(iterations):
            start = time.perf_counter_ns()
            public_key.verify(signature, payload)
            elapsed_us = (time.perf_counter_ns() - start) / 1000
            verify_times.append(elapsed_us)
        
        result = {
            "iterations": iterations,
            "payload_size_bytes": len(payload),
            "sign": {
                "median_us": round(statistics.median(sign_times), 3),
                "mean_us": round(statistics.mean(sign_times), 3),
                "min_us": round(min(sign_times), 3),
                "max_us": round(max(sign_times), 3),
                "ops_per_second": round(iterations / (sum(sign_times) / 1_000_000), 1),
            },
            "verify": {
                "median_us": round(statistics.median(verify_times), 3),
                "mean_us": round(statistics.mean(verify_times), 3),
                "min_us": round(min(verify_times), 3),
                "max_us": round(max(verify_times), 3),
                "ops_per_second": round(iterations / (sum(verify_times) / 1_000_000), 1),
            },
        }
        
        RESULTS["ed25519"][size_name] = result
        print(f"  Ed25519 {size_name}: sign={result['sign']['median_us']}µs, verify={result['verify']['median_us']}µs")

def bench_blake3():
    """Benchmark BLAKE3 hashing."""
    if not HAS_BLAKE3:
        # Fall back to hashlib blake3 if available, or skip
        try:
            h = hashlib.blake3(b"test")
            has_lib = False
        except (AttributeError, ImportError):
            has_lib = False
        if not has_lib:
            print("skipping blake3 (library not available)")
            RESULTS["blake3"]["error"] = "blake3 library not available"
            return
    else:
        has_lib = True
    
    print("\n--- BLAKE3 Benchmarks ---")
    
    payloads = {
        "1KB": b"x" * 1024,
        "10KB": b"x" * 10240,
        "100KB": b"x" * 102400,
        "1MB": b"x" * 1048576,
    }
    
    iterations = {
        "1KB": 100000,
        "10KB": 10000,
        "100KB": 1000,
        "1MB": 100,
    }
    
    for size_name, payload in payloads.items():
        iters = iterations[size_name]
        times = []
        for _ in range(iters):
            start = time.perf_counter_ns()
            if HAS_BLAKE3:
                _ = blake3.blake3(payload).digest()
            else:
                _ = blake3.blake3(payload).digest()
            elapsed_us = (time.perf_counter_ns() - start) / 1000
            times.append(elapsed_us)
        
        result = {
            "iterations": iters,
            "payload_size_bytes": len(payload),
            "median_us": round(statistics.median(times), 3),
            "mean_us": round(statistics.mean(times), 3),
            "min_us": round(min(times), 3),
            "max_us": round(max(times), 3),
            "throughput_mbps": round((len(payload) * iters) / (sum(times) / 1_000_000) / (1024 * 1024), 2),
        }
        
        RESULTS["blake3"][size_name] = result
        print(f"  BLAKE3 {size_name}: median={result['median_us']}µs, throughput={result['throughput_mbps']} MB/s")

def bench_mldsa87():
    """
    Benchmark ML-DSA-87 (post-quantum) via the vardhan-receipt binary.
    Since pqcrypto libraries are Rust-only, we measure the end-to-end
    sign+verify time per transaction via the subprocess interface.
    """
    print("\n--- ML-DSA-87 Benchmarks (via vardhan-receipt) ---")
    
    receipt_bin = os.environ.get("VARDHAN_RECEIPT_ENGINE_BIN", "/usr/local/bin/vardhan-receipt")
    
    if not os.path.exists(receipt_bin):
        # Try relative path
        receipt_bin = "vardhan-receipt"
    
    # Build a canonical contract for benchmarking
    contract = {
        "contract": {
            "schema_version": "1.1",
            "finding_id": "find-crypto-bench",
            "intelligence": {"engine_id": "crypto-bench", "engine_version": "1.0.0", "run_id": "run-cb-001"},
            "organization": {"organization_id": "org-vardhan-intelligence", "canonical_domain": "crypto.bench"},
            "affected_resource": {"canonical_url": "https://api.bench.org", "surface_type": "API_REST", "entry_point_id": "ep-cb-1"},
            "technical_area": "STATIC_ANALYSIS",
            "technical_mechanism": "SQLi",
            "expected_behavior": "safe",
            "observed_behavior": "vulnerable",
            "differential_state": "CONFIRMED_MISMATCH",
            "materiality": "HIGH",
            "evidence_refs": [{"evidence_id": "ev-cb-1", "public_url": "https://ev.bench.org", "temporal_status": "CURRENT", "is_context_artifact": False, "evidence_origin": "scan", "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}],
            "provenance_chain": {"expectation_id": "e1", "observation_ids": ["o1"], "differential_id": "d1", "hypothesis_id": "h1", "verification_contract_id": "v1"},
            "contradictory_evidence_ids": [],
            "uncertainty": [],
            "benign_explanation": "",
            "authorization_context": {"requires_authorized_assessment": False},
            "decision_candidate": "SEAL_VERIFIED_FINDING",
            "policy_reference": "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "created_at": "2026-10-13T10:00:00Z",
            "evidence_earliest_retrieved_at": "2026-10-13T09:00:00Z",
            "evidence_latest_retrieved_at": "2026-10-13T09:30:00Z"
        },
        "actor_workload_id": "svc:vardhan-intelligence:crypto-bench"
    }
    
    payload = json.dumps(contract)
    
    # First run to get the receipt
    env = os.environ.copy()
    env["VARDHAN_ENV"] = "development"
    
    # Warm up (with unique finding_ids to avoid idempotency replay)
    for i in range(3):
        c = json.loads(payload)
        c["contract"]["finding_id"] = f"find-crypto-warmup-{i}"
        try:
            subprocess.run([receipt_bin, "validate-canonical"],
                           input=json.dumps(c).encode(), capture_output=True, env=env, timeout=30)
        except Exception:
            pass
    
    # Measure signing (full validate-canonical = hash + seal + ML-DSA-87 sign)
    iterations = 100
    sign_times = []
    sign_successes = 0
    
    for i in range(iterations):
        c = json.loads(payload)
        c["contract"]["finding_id"] = f"find-crypto-sign-{i}"
        start = time.monotonic()
        result = subprocess.run([receipt_bin, "validate-canonical"],
                                input=json.dumps(c).encode(), capture_output=True, env=env, timeout=30)
        elapsed_ms = (time.monotonic() - start) * 1000
        sign_times.append(elapsed_ms)
        if result.returncode == 0:
            sign_successes += 1
    
    # Get a valid receipt for verification benchmarks (single run)
    c = json.loads(payload)
    c["contract"]["finding_id"] = f"find-crypto-verify-seed"
    result = subprocess.run([receipt_bin, "validate-canonical"],
                            input=json.dumps(c).encode(), capture_output=True, env=env, timeout=30)
    receipt_json = result.stdout.decode()
    
    # Measure verification (no idempotency check, can reuse same receipt)
    verify_times = []
    for _ in range(iterations):
        start = time.monotonic()
        subprocess.run([receipt_bin, "verify", "--receipt-id", "crypto-bench"],
                       input=receipt_json.encode(), capture_output=True, env=env, timeout=30)
        elapsed_ms = (time.monotonic() - start) * 1000
        verify_times.append(elapsed_ms)
    
    RESULTS["mldsa87"]["sign"] = {
        "measurement_scope": "Full vardhan-receipt validate-canonical subprocess; includes process startup, parsing, hashing, key access, sealing and serialization, not an isolated ML-DSA-87 primitive timing.",
        "iterations": iterations,
        "successes": sign_successes,
        "median_ms": round(statistics.median(sign_times), 3),
        "mean_ms": round(statistics.mean(sign_times), 3),
        "min_ms": round(min(sign_times), 3),
        "max_ms": round(max(sign_times), 3),
        "ops_per_second": round(iterations / (sum(sign_times) / 1000), 1),
    }
    
    RESULTS["mldsa87"]["verify"] = {
        "measurement_scope": "Full vardhan-receipt verify subprocess for a receipt; not an isolated ML-DSA-87 primitive timing.",
        "iterations": iterations,
        "median_ms": round(statistics.median(verify_times), 3),
        "mean_ms": round(statistics.mean(verify_times), 3),
        "min_ms": round(min(verify_times), 3),
        "max_ms": round(max(verify_times), 3),
        "ops_per_second": round(iterations / (sum(verify_times) / 1000), 1),
    }
    
    print(f"  ML-DSA-87 full validate-canonical CLI path: median={RESULTS['mldsa87']['sign']['median_ms']}ms")
    print(f"  ML-DSA-87 full receipt verify CLI path: median={RESULTS['mldsa87']['verify']['median_ms']}ms")

    # Extract signature sizes from receipt if available
    try:
        receipt = json.loads(receipt_json)
        sigs = receipt.get("signatures", {})
        if "ed25519_sig" in sigs:
            RESULTS["ed25519"]["signature_size_bytes"] = len(bytes.fromhex(sigs["ed25519_sig"]))
        if "ml_dsa_87_sig" in sigs:
            RESULTS["mldsa87"]["signature_size_bytes"] = len(bytes.fromhex(sigs["mldsa87_sig"]))
        RESULTS["qcore_integration"]["receipt_id"] = receipt.get("receipt_id", "")
        RESULTS["qcore_integration"]["payload_hash_algorithm"] = receipt.get("payload_hash_algorithm", "")
        RESULTS["qcore_integration"]["signature_schemes"] = list(sigs.keys())
    except Exception:
        pass

def main():
    print("=" * 60)
    print("  VARDHAN Q-CORE — Cryptographic Microbenchmarks")
    print("=" * 60)
    
    bench_ed25519()
    bench_blake3()
    bench_mldsa87()
    
    print("\n" + "=" * 60)
    print("  Crypto Benchmark Summary")
    print("=" * 60)
    
    # Print summary table
    print(f"\n{'Algorithm':<20} {'Operation':<12} {'Median':>12}")
    print("-" * 44)
    for algo in ["ed25519", "mldsa87", "blake3"]:
        if algo in RESULTS:
            for op, data in RESULTS[algo].items():
                if isinstance(data, dict) and "median_us" in data:
                    print(f"{algo:<20} {op:<12} {data['median_us']}µs")
                elif isinstance(data, dict) and "median_ms" in data:
                    print(f"{algo:<20} {op:<12} {data['median_ms']}ms")
    
    # Write results to file
    output_file = os.environ.get("CRYPTO_RESULTS_FILE", "/tmp/crypto_results.json")
    with open(output_file, "w") as f:
        json.dump(RESULTS, f, indent=2)
    print(f"\nResults written to {output_file}")

if __name__ == "__main__":
    main()
