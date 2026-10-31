#!/usr/bin/env python3
"""
VARDHAN Q-CORE — Public PQC TLS Readiness Checker Bridge
Standard: X25519MLKEM768 / NIST FIPS 203 (ML-KEM-768)
Integration: CertKit PQC TLS Readiness Engine (app.certkit.io)

Analyzes any public Q-Core Cloudflare demo endpoint (or custom domain)
for Post-Quantum TLS 1.3 readiness, negotiated hybrid key exchange groups,
TLS 1.2 exposure, and certificate chains.
"""

import sys
import os
import json
import urllib.request
import urllib.error
import time

CERTKIT_API_URL = "https://app.certkit.io/tools/pqc-checker?handler=Analyze"

def check_endpoint(target_host):
    # Clean host input
    host = target_host.replace("https://", "").replace("http://", "").split("/")[0].strip()
    if not host:
        print("[ERROR] Target host cannot be empty.")
        sys.exit(1)

    print("=" * 70)
    print(f"  VARDHAN Q-CORE: PQC TLS READINESS AUDIT FOR {host}")
    print("  Engine: CertKit PQC TLS Checker | Group: X25519MLKEM768")
    print("=" * 70)

    payload = json.dumps({"target": host}).encode("utf-8")
    req = urllib.request.Request(
        CERTKIT_API_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Vardhan-QCore-PqcTlsAudit/1.0"
        }
    )

    try:
        t0 = time.perf_counter()
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        elapsed_sec = time.perf_counter() - t0
    except urllib.error.HTTPError as e:
        print(f"[FAIL] HTTP error querying CertKit API ({e.code}): {e.reason}")
        return False
    except Exception as e:
        print(f"[FAIL] Connection error: {e}")
        return False

    if not data.get("success") or "analysis" not in data:
        print(f"[FAIL] Audit failed: {data.get('message', 'No analysis returned')}")
        return False

    a = data["analysis"]
    print(f"\n[+] Analysis Completed in {elapsed_sec:.2f}s:")
    print(f"    - Target Endpoint:        {a.get('target')} ({a.get('ipAddress', 'N/A')})")
    print(f"    - Negotiated Protocol:    {a.get('protocol')}")
    print(f"    - Key Exchange:           {a.get('keyExchange')}")
    print(f"    - Post-Quantum Preferred: {a.get('postQuantumKeyExchangePreferred')}")
    print(f"    - PQC Groups Supported:   {', '.join(a.get('supportedPostQuantumGroups', [])) or 'None'}")
    print(f"    - Symmetric Cipher:       {a.get('symmetricCipher')} ({a.get('cipherSuite')})")
    print(f"    - Certificate Signature:  {a.get('certificateSignatureAlgorithm')}")
    print(f"    - TLS 1.2 Exposure:       {a.get('tls12Offered')}")

    print("\n[+] Handshake Probes:")
    for probe in a.get("probes", []):
        mark = "[PASS]" if probe.get("succeeded") else "[FAIL]"
        pq_flag = "(PQC Hybrid)" if probe.get("keyExchangeIsPostQuantum") else ""
        print(f"    {mark} {probe.get('name')}: {probe.get('keyExchange', 'N/A')} {pq_flag}")

    report_path = os.path.join(os.path.dirname(__file__), "..", "tests", "interop", f"pqc_tls_{host.replace('.', '_')}.json")
    with open(report_path, "w") as f:
        json.dump(a, f, indent=2)
    print(f"\n[✓] Detailed JSON evidence report saved to:\n    {report_path}")

    # Honest architectural evaluation notice
    print("\n" + "-" * 70)
    print("ARCHITECTURAL NOTE ON CLOUDFLARE TUNNEL TLS TERMINATION:")
    print("When using Cloudflare Tunnel (trycloudflare.com), public client TLS 1.3")
    print("terminates at Cloudflare edge PoPs (which support X25519MLKEM768).")
    print("Origin-to-Cloudflare traffic passes through an encrypted QUIC tunnel.")
    print("-" * 70)

    return True

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/validate_public_pqc_tls.py <hostname-or-tunnel-url>")
        sys.exit(1)
    check_endpoint(sys.argv[1])
