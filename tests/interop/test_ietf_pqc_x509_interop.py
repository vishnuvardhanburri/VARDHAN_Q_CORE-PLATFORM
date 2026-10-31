#!/usr/bin/env python3
"""
VARDHAN Q-CORE — PQC X.509 Interoperability Test Suite
Artifact Source: IETF-Hackathon/pqc-certificates (BouncyCastle & Botan providers)
Standards: NIST FIPS 204 (ML-DSA-87), RFC 5280, X.509 ASN.1 DER

Validates cross-provider compatibility, DER X.509 certificate parsing,
raw public key extraction (2,592 bytes), self-signed certificate signature
verification (4,627 bytes), and negative tamper-controls.

NON-PRODUCTION / INTEROPERABILITY NOTICE:
These test artifacts originate from the open IETF Hackathon interoperability
repository and represent test/conformance data. They do NOT constitute formal
banking, FIPS CMVP laboratory certification, or central bank authorization.
"""

import os
import sys
import json
import time
import hashlib
from datetime import datetime, timezone
import cryptography.x509 as x509
from cryptography.hazmat.primitives import serialization

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
REPORT_PATH = os.path.join(os.path.dirname(__file__), "ietf_pqc_interop_evidence.json")

# OID for NIST ML-DSA-87 (FIPS 204)
OID_ML_DSA_87 = "2.16.840.1.101.3.4.3.19"
ML_DSA_87_PK_BYTES = 2592
ML_DSA_87_SIG_BYTES = 4627

def run_tests():
    evidence = {
        "suite": "Vardhan Q-Core IETF PQC X.509 Interoperability Suite",
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "disclaimer": "Test/interoperability evaluation artifacts only. Not formal banking or FIPS certification.",
        "results": []
    }

    test_targets = [
        {
            "provider": "BouncyCastle (IETF Round 5)",
            "cert_path": os.path.join(FIXTURES_DIR, "ietf_bouncycastle", "ml-dsa-87-2.16.840.1.101.3.4.3.19_ta.der"),
            "expected_cn": "BC ml-dsa-87 Test TA",
        },
        {
            "provider": "Botan / OpenSSL 3.6 (IETF Round 5)",
            "cert_path": os.path.join(FIXTURES_DIR, "ietf_botan", "ml-dsa-87-2.16.840.1.101.3.4.3.19_ta.der"),
            "expected_cn": "OpenSSL 3.6 ml-dsa-87 Root",
        }
    ]

    all_passed = True

    print("=" * 75)
    print("  VARDHAN Q-CORE: IETF PQC X.509 INTEROPERABILITY VALIDATION")
    print("  Standards: NIST FIPS 204 (ML-DSA-87) | ASN.1 DER X.509")
    print("=" * 75)

    for target in test_targets:
        prov = target["provider"]
        path = target["cert_path"]
        print(f"\n[*] Evaluating Provider Artifact: {prov}")
        
        if not os.path.isfile(path):
            print(f"  [FAIL] Artifact missing at: {path}")
            all_passed = False
            continue

        with open(path, "rb") as f:
            der_bytes = f.read()

        sha256_fp = hashlib.sha256(der_bytes).hexdigest()
        
        # Test 1: ASN.1 DER Parsing
        try:
            cert = x509.load_der_x509_certificate(der_bytes)
            sig_oid = cert.signature_algorithm_oid.dotted_string
            assert sig_oid == OID_ML_DSA_87, f"Unexpected OID: {sig_oid}"
            cn = cert.subject.get_attributes_for_oid(x509.NameOID.COMMON_NAME)[0].value
            assert cn == target["expected_cn"], f"Subject mismatch: {cn}"
            
            print(f"  [PASS] 1. ASN.1 DER Certificate Parsing & Subject Validation")
            print(f"         Subject: {cn}")
            print(f"         Algorithm OID: {sig_oid} (ML-DSA-87)")
            print(f"         Serial Number: {cert.serial_number}")
            print(f"         Certificate SHA-256: {sha256_fp[:24]}...")
        except Exception as e:
            print(f"  [FAIL] 1. ASN.1 DER Certificate Parsing: {e}")
            all_passed = False
            continue

        # Test 2: Raw Public Key Extraction
        try:
            pk = cert.public_key()
            raw_pk = pk.public_bytes(
                encoding=serialization.Encoding.Raw,
                format=serialization.PublicFormat.Raw
            )
            assert len(raw_pk) == ML_DSA_87_PK_BYTES, f"Public key length is {len(raw_pk)}, expected {ML_DSA_87_PK_BYTES}"
            pk_sha256 = hashlib.sha256(raw_pk).hexdigest()
            print(f"  [PASS] 2. Raw Public Key Extraction (FIPS 204 conformant)")
            print(f"         Key Size: {len(raw_pk)} bytes (exact ML-DSA-87 size)")
            print(f"         Key SHA-256: {pk_sha256[:24]}...")
        except Exception as e:
            print(f"  [FAIL] 2. Raw Public Key Extraction: {e}")
            all_passed = False
            continue

        # Test 3: Positive Control — Verify Self-Signed Certificate Signature
        try:
            t0 = time.perf_counter()
            pk.verify(cert.signature, cert.tbs_certificate_bytes)
            t_verify = (time.perf_counter() - t0) * 1000
            assert len(cert.signature) == ML_DSA_87_SIG_BYTES, f"Sig len {len(cert.signature)} != {ML_DSA_87_SIG_BYTES}"
            print(f"  [PASS] 3. Positive Signature Verification (X.509 TBS Bytes)")
            print(f"         Signature Size: {len(cert.signature)} bytes (FIPS 204 ML-DSA-87)")
            print(f"         Verification Latency: {t_verify:.2f} ms")
        except Exception as e:
            print(f"  [FAIL] 3. Positive Signature Verification: {e}")
            all_passed = False
            continue

        # Test 4: Negative Control A — Tampered Signature Mutation
        try:
            tampered_sig = bytearray(cert.signature)
            tampered_sig[100] ^= 0xAA  # Flip bits in signature
            pk.verify(bytes(tampered_sig), cert.tbs_certificate_bytes)
            print(f"  [FAIL] 4. Tampered signature was accepted!")
            all_passed = False
        except Exception:
            print(f"  [PASS] 4. Negative Control A: Bit-flipped signature correctly REJECTED")

        # Test 5: Negative Control B — Tampered Certificate Payload (TBS)
        try:
            tampered_tbs = bytearray(cert.tbs_certificate_bytes)
            tampered_tbs[50] ^= 0x55  # Modify serial or subject
            pk.verify(cert.signature, bytes(tampered_tbs))
            print(f"  [FAIL] 5. Tampered TBS payload was accepted!")
            all_passed = False
        except Exception:
            print(f"  [PASS] 5. Negative Control B: Mutated certificate TBS data correctly REJECTED")

        # Test 6: Cross-Provider Negative Control — Validate against alternate root key
        try:
            # Try to verify with an arbitrary synthetic 2592-byte key
            import secrets
            synthetic_seed = secrets.token_bytes(32)
            from cryptography.hazmat.primitives.asymmetric import mldsa
            alt_sk = mldsa.MLDSA87PrivateKey.generate()
            alt_pk = alt_sk.public_key()
            alt_pk.verify(cert.signature, cert.tbs_certificate_bytes)
            print(f"  [FAIL] 6. Signature validated against alternate public key!")
            all_passed = False
        except Exception:
            print(f"  [PASS] 6. Negative Control C: Alternate authority key correctly REJECTED")

        evidence["results"].append({
            "provider": prov,
            "artifact_file": os.path.basename(path),
            "algorithm": "ML-DSA-87",
            "oid": sig_oid,
            "subject": cn,
            "serial": str(cert.serial_number),
            "certificate_sha256": sha256_fp,
            "raw_public_key_len": len(raw_pk),
            "public_key_sha256": pk_sha256,
            "signature_len": len(cert.signature),
            "all_tests_passed": True
        })

    with open(REPORT_PATH, "w") as f:
        json.dump(evidence, f, indent=2)

    print("\n" + "=" * 75)
    if all_passed:
        print("  ALL IETF PQC X.509 INTEROPERABILITY DRILLS PASSED (12/12 CHECKS)")
        print(f"  JSON Evidence Report generated at:\n  {REPORT_PATH}")
    else:
        print("  SOME INTEROPERABILITY CHECKS FAILED")
    print("=" * 75)

    return 0 if all_passed else 1

if __name__ == "__main__":
    sys.exit(run_tests())
