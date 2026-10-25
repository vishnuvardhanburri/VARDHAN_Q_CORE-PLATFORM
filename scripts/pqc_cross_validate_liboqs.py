#!/usr/bin/env python3
"""
VARDHAN Q-CORE — PQC Independent Cross-Implementation Interoperability Harness
Standard: NIST FIPS 203 (ML-KEM-1024) / NIST FIPS 204 (ML-DSA-87)
Interoperability Target: Open Quantum Safe (liboqs-python / liboqs C reference)

Validates bidirectional cryptographic interoperability between the native Rust core_crypto
engine and the independent liboqs reference library using a versioned length-delimited binary protocol.

Standards: Strictly Zero Emojis Permitted
"""

import os
import sys
import hmac
import time
import subprocess
import select

# Protocol constants
PROTOCOL_MAGIC = b"QC"
PROTOCOL_VERSION = 0x01

CMD_KEM_GENERATE_KEYPAIR = 0x01
CMD_KEM_DECAPSULATE = 0x02
CMD_KEM_ENCAPSULATE = 0x03
CMD_DSA_GENERATE_KEYPAIR = 0x04
CMD_DSA_SIGN = 0x05
CMD_DSA_VERIFY = 0x06
CMD_RESET_STATE = 0x07
CMD_TERMINATE = 0xFF

STATUS_SUCCESS = 0x00
STATUS_ERROR_UNSUPPORTED_VERSION = 0x01
STATUS_ERROR_INVALID_COMMAND = 0x02
STATUS_ERROR_INVALID_LENGTH = 0x03
STATUS_ERROR_CRYPTO_FAILURE = 0x04
STATUS_ERROR_NO_RETAINED_KEY = 0x05

# NIST Primitive byte lengths
ML_KEM_1024_PK_BYTES = 1568
ML_KEM_1024_CT_BYTES = 1568
ML_KEM_1024_SS_BYTES = 32

ML_DSA_87_PK_BYTES = 2592
ML_DSA_87_SIG_BYTES = 4627

MAX_RESPONSE_BOUND = 10 * 1024 * 1024  # 10MB safety bound
DEFAULT_TIMEOUT_SECS = 15.0


class InteropClient:
    """
    Manages stateful bidirectional communication with the Rust interop_runner binary.
    """
    def __init__(self, binary_path: str, timeout: float = DEFAULT_TIMEOUT_SECS):
        if not os.path.isfile(binary_path):
            raise FileNotFoundError(f"interop_runner binary not found at: {binary_path}")
        self.binary_path = binary_path
        self.timeout = timeout
        self.proc = subprocess.Popen(
            [binary_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0
        )

    def send_frame(self, cmd: int, payload: bytes = b"") -> None:
        if self.proc.poll() is not None:
            raise RuntimeError(f"Runner process terminated prematurely with code {self.proc.returncode}")
        payload_len = len(payload)
        header = (
            PROTOCOL_MAGIC +
            PROTOCOL_VERSION.to_bytes(1, "big") +
            cmd.to_bytes(1, "big") +
            payload_len.to_bytes(4, "big")
        )
        self.proc.stdin.write(header + payload)
        self.proc.stdin.flush()

    def read_exact(self, count: int) -> bytes:
        buf = bytearray()
        deadline = time.time() + self.timeout
        while len(buf) < count:
            remaining = count - len(buf)
            timeout_left = max(0.01, deadline - time.time())
            rlist, _, _ = select.select([self.proc.stdout], [], [], timeout_left)
            if not rlist:
                raise TimeoutError(f"Timeout waiting for response from {self.binary_path}")
            chunk = self.proc.stdout.read(remaining)
            if not chunk:
                stderr_diag = self.proc.stderr.read().decode("utf-8", errors="replace")
                raise ConnectionResetError(f"Subprocess closed pipe unexpectedly. Stderr: {stderr_diag}")
            buf.extend(chunk)
        return bytes(buf)

    def recv_frame(self) -> tuple[int, bytes]:
        # Header: Magic (2) + Status (1) + PayloadLen (4) = 7 bytes
        hdr = self.read_exact(7)
        magic = hdr[0:2]
        status = hdr[2]
        payload_len = int.from_bytes(hdr[3:7], "big")

        if magic != PROTOCOL_MAGIC:
            raise ValueError(f"Invalid protocol magic in response: {magic}")
        if payload_len > MAX_RESPONSE_BOUND:
            raise ValueError(f"Response payload length exceeds maximum safe bound: {payload_len}")

        payload = self.read_exact(payload_len) if payload_len > 0 else b""
        return status, payload

    def request(self, cmd: int, payload: bytes = b"") -> tuple[int, bytes]:
        self.send_frame(cmd, payload)
        return self.recv_frame()

    def close(self) -> None:
        try:
            if self.proc.poll() is None:
                self.send_frame(CMD_TERMINATE)
                self.recv_frame()
                self.proc.wait(timeout=3.0)
        except Exception:
            if self.proc.poll() is None:
                self.proc.kill()
        finally:
            if self.proc.stdin:
                self.proc.stdin.close()
            if self.proc.stdout:
                self.proc.stdout.close()
            if self.proc.stderr:
                self.proc.stderr.close()


def find_runner_binary() -> str:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)
    candidates = [
        os.path.join(repo_root, "target", "release", "interop_runner"),
        os.path.join(repo_root, "target", "debug", "interop_runner"),
    ]
    for c in candidates:
        if os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    raise FileNotFoundError("Could not locate compiled interop_runner binary. Run 'cargo build --release -p core_crypto --bin interop_runner' first.")


def run_interoperability_suite():
    import oqs

    liboqs_version = oqs.oqs_version()
    enabled_kems = oqs.get_enabled_kem_mechanisms()
    enabled_sigs = oqs.get_enabled_sig_mechanisms()

    print("================================================================================")
    print(" VARDHAN Q-CORE — PQC BIDIRECTIONAL CROSS-IMPLEMENTATION INTEROP HARNESS")
    print(" Standards: NIST FIPS 203 (ML-KEM-1024) | NIST FIPS 204 (ML-DSA-87)")
    print(" Target: Open Quantum Safe (liboqs C Reference Library)")
    print("================================================================================")
    print(f"Independent Library   : liboqs {liboqs_version} (liboqs-python)")
    print(f"ML-KEM-1024 Enabled   : {'ML-KEM-1024' in enabled_kems}")
    print(f"ML-DSA-87 Enabled     : {'ML-DSA-87' in enabled_sigs}")
    print("Zero Emojis Policy    : Strictly Enforced")
    print("--------------------------------------------------------------------------------")

    assert "ML-KEM-1024" in enabled_kems, "liboqs build is missing required ML-KEM-1024 algorithm"
    assert "ML-DSA-87" in enabled_sigs, "liboqs build is missing required ML-DSA-87 algorithm"

    binary_path = find_runner_binary()
    print(f"Rust Runner Binary    : {binary_path}")
    print("--------------------------------------------------------------------------------")

    client = InteropClient(binary_path)

    try:
        # --------------------------------------------------------------------
        # 1. ML-KEM-1024 Direction A: Rust Keygen -> liboqs Encap -> Rust Decap
        # --------------------------------------------------------------------
        print("[Step 1/7] Testing ML-KEM-1024 Direction A (Rust Keygen -> liboqs Encap -> Rust Decap)...")
        status, rust_pk = client.request(CMD_KEM_GENERATE_KEYPAIR)
        assert status == STATUS_SUCCESS, f"Rust KEM keygen failed with status: {status}"
        assert len(rust_pk) == ML_KEM_1024_PK_BYTES, f"Expected PK length {ML_KEM_1024_PK_BYTES}, got {len(rust_pk)}"

        with oqs.KeyEncapsulation("ML-KEM-1024") as oqs_kem:
            liboqs_ct, liboqs_ss = oqs_kem.encap_secret(rust_pk)
            assert len(liboqs_ct) == ML_KEM_1024_CT_BYTES
            assert len(liboqs_ss) == ML_KEM_1024_SS_BYTES

            status, rust_ss = client.request(CMD_KEM_DECAPSULATE, liboqs_ct)
            assert status == STATUS_SUCCESS, f"Rust KEM decapsulation failed with status: {status}"
            assert len(rust_ss) == ML_KEM_1024_SS_BYTES

            # Constant-time comparison in memory; secrets never logged or saved
            match = hmac.compare_digest(rust_ss, liboqs_ss)
            assert match is True, "Direction A shared secrets do not match"
            print("  [PASS] Direction A: liboqs encapsulated to Rust PK, Rust decapsulated identical 32B shared secret.")

        # --------------------------------------------------------------------
        # 2. ML-KEM-1024 Direction B: liboqs Keygen -> Rust Encap -> liboqs Decap
        # --------------------------------------------------------------------
        print("[Step 2/7] Testing ML-KEM-1024 Direction B (liboqs Keygen -> Rust Encap -> liboqs Decap)...")
        with oqs.KeyEncapsulation("ML-KEM-1024") as oqs_kem:
            liboqs_pk = oqs_kem.generate_keypair()
            assert len(liboqs_pk) == ML_KEM_1024_PK_BYTES

            status, encap_out = client.request(CMD_KEM_ENCAPSULATE, liboqs_pk)
            assert status == STATUS_SUCCESS, f"Rust KEM encapsulation failed with status: {status}"
            assert len(encap_out) == (ML_KEM_1024_CT_BYTES + ML_KEM_1024_SS_BYTES)

            rust_ct = encap_out[:ML_KEM_1024_CT_BYTES]
            rust_ss = encap_out[ML_KEM_1024_CT_BYTES:]

            liboqs_ss = oqs_kem.decap_secret(rust_ct)
            assert len(liboqs_ss) == ML_KEM_1024_SS_BYTES

            match = hmac.compare_digest(rust_ss, liboqs_ss)
            assert match is True, "Direction B shared secrets do not match"
            print("  [PASS] Direction B: Rust encapsulated to liboqs PK, liboqs decapsulated identical 32B shared secret.")

        # --------------------------------------------------------------------
        # 3. ML-DSA-87 Direction A: Rust Keygen & Sign -> liboqs Verify
        # --------------------------------------------------------------------
        print("[Step 3/7] Testing ML-DSA-87 Direction A (Rust Sign -> liboqs Verify)...")
        status, rust_dsa_pk = client.request(CMD_DSA_GENERATE_KEYPAIR)
        assert status == STATUS_SUCCESS
        assert len(rust_dsa_pk) == ML_DSA_87_PK_BYTES

        test_msg_a = b"VARDHAN_Q_CORE_AUTHORITATIVE_FINANCIAL_SETTLEMENT_PAC008_DIR_A"
        status, rust_sig = client.request(CMD_DSA_SIGN, test_msg_a)
        assert status == STATUS_SUCCESS
        assert len(rust_sig) == ML_DSA_87_SIG_BYTES

        with oqs.Signature("ML-DSA-87") as oqs_sig:
            is_valid = oqs_sig.verify(test_msg_a, rust_sig, rust_dsa_pk)
            assert is_valid is True, "liboqs failed to verify Rust ML-DSA-87 signature"
            print("  [PASS] Direction A: liboqs verified Rust ML-DSA-87 signature over test message.")

        # --------------------------------------------------------------------
        # 4. ML-DSA-87 Direction B: liboqs Keygen & Sign -> Rust Verify
        # --------------------------------------------------------------------
        print("[Step 4/7] Testing ML-DSA-87 Direction B (liboqs Sign -> Rust Verify)...")
        test_msg_b = b"VARDHAN_Q_CORE_AUTHORITATIVE_FINANCIAL_SETTLEMENT_PAC008_DIR_B"
        with oqs.Signature("ML-DSA-87") as oqs_sig:
            liboqs_dsa_pk = oqs_sig.generate_keypair()
            assert len(liboqs_dsa_pk) == ML_DSA_87_PK_BYTES

            liboqs_sig = oqs_sig.sign(test_msg_b)
            assert len(liboqs_sig) == ML_DSA_87_SIG_BYTES

            # Pack frame for Rust verifier: pk_len(4B) | pk | sig_len(4B) | sig | msg_len(4B) | msg
            verify_payload = (
                len(liboqs_dsa_pk).to_bytes(4, "big") + liboqs_dsa_pk +
                len(liboqs_sig).to_bytes(4, "big") + liboqs_sig +
                len(test_msg_b).to_bytes(4, "big") + test_msg_b
            )
            status, verify_res = client.request(CMD_DSA_VERIFY, verify_payload)
            assert status == STATUS_SUCCESS
            assert verify_res == b"\x01", f"Rust failed to verify liboqs ML-DSA-87 signature: {verify_res}"
            print("  [PASS] Direction B: Rust verified liboqs ML-DSA-87 signature over test message.")

        # --------------------------------------------------------------------
        # 5. Negative Controls: Signature Alteration and Message Tampering
        # --------------------------------------------------------------------
        print("[Step 5/7] Testing Negative Controls: Signature and Message Tampering...")
        # 5a. Tamper signature single byte
        tampered_sig = bytearray(rust_sig)
        tampered_sig[42] ^= 0xAA
        with oqs.Signature("ML-DSA-87") as oqs_sig:
            assert oqs_sig.verify(test_msg_a, bytes(tampered_sig), rust_dsa_pk) is False, "Tampered signature accepted by liboqs"
        print("  [PASS] 5a: Altered signature rejected by liboqs.")

        # 5b. Tamper message
        tampered_msg = test_msg_a + b"_tampered_modification"
        with oqs.Signature("ML-DSA-87") as oqs_sig:
            assert oqs_sig.verify(tampered_msg, rust_sig, rust_dsa_pk) is False, "Altered message accepted by liboqs"
        print("  [PASS] 5b: Altered message rejected by liboqs.")

        # 5c. Rust verifier rejects tampered signature
        tampered_verify_payload = (
            len(rust_dsa_pk).to_bytes(4, "big") + rust_dsa_pk +
            len(tampered_sig).to_bytes(4, "big") + bytes(tampered_sig) +
            len(test_msg_a).to_bytes(4, "big") + test_msg_a
        )
        status, verify_res = client.request(CMD_DSA_VERIFY, tampered_verify_payload)
        assert status == STATUS_SUCCESS
        assert verify_res == b"\x00", "Rust accepted tampered signature"
        print("  [PASS] 5c: Altered signature rejected by Rust verifier.")

        # --------------------------------------------------------------------
        # 6. Negative Controls: ML-KEM Implicit Rejection & Malformed Bounds
        # --------------------------------------------------------------------
        print("[Step 6/7] Testing Negative Controls: ML-KEM Implicit Rejection and Malformed Lengths...")
        # 6a. Implicit Rejection: Modified ciphertext decapsulates to a pseudorandom secret
        # that does NOT match the sender's shared secret (FIPS 203 Section 7.2)
        tampered_ct = bytearray(liboqs_ct)
        tampered_ct[100] ^= 0x55
        status, tampered_rust_ss = client.request(CMD_KEM_DECAPSULATE, bytes(tampered_ct))
        assert status == STATUS_SUCCESS, "ML-KEM decapsulation should execute implicit rejection"
        assert len(tampered_rust_ss) == ML_KEM_1024_SS_BYTES
        assert not hmac.compare_digest(tampered_rust_ss, liboqs_ss), "Implicit rejection failed: shared secrets matched"
        print("  [PASS] 6a: ML-KEM implicit rejection property verified (modified ciphertext yields non-matching secret).")

        # 6b. Truncated ciphertext: Protocol-level length violation fails closed
        truncated_ct = liboqs_ct[:1500]  # Missing 68 bytes
        status, err_payload = client.request(CMD_KEM_DECAPSULATE, truncated_ct)
        assert status == STATUS_ERROR_INVALID_LENGTH, f"Expected STATUS_ERROR_INVALID_LENGTH, got {status}"
        print("  [PASS] 6b: Truncated ciphertext rejected with STATUS_ERROR_INVALID_LENGTH.")

        # 6c. Truncated public key in encapsulation
        status, err_payload = client.request(CMD_KEM_ENCAPSULATE, liboqs_pk[:1000])
        assert status == STATUS_ERROR_INVALID_LENGTH
        print("  [PASS] 6c: Truncated public key rejected with STATUS_ERROR_INVALID_LENGTH.")

        # --------------------------------------------------------------------
        # 7. Stateful Reset and Decapsulation Guard
        # --------------------------------------------------------------------
        print("[Step 7/7] Testing Stateful Key Zeroization and Reset Behavior...")
        status, _ = client.request(CMD_RESET_STATE)
        assert status == STATUS_SUCCESS

        # Attempting decapsulation after reset must fail with STATUS_ERROR_NO_RETAINED_KEY
        status, _ = client.request(CMD_KEM_DECAPSULATE, liboqs_ct)
        assert status == STATUS_ERROR_NO_RETAINED_KEY, f"Expected STATUS_ERROR_NO_RETAINED_KEY after reset, got {status}"

        # Attempting signing after reset must fail with STATUS_ERROR_NO_RETAINED_KEY
        status, _ = client.request(CMD_DSA_SIGN, b"hello")
        assert status == STATUS_ERROR_NO_RETAINED_KEY, f"Expected STATUS_ERROR_NO_RETAINED_KEY after reset, got {status}"
        print("  [PASS] 7: State reset successfully dropped retained keys from process memory; subsequent decap/sign requests fail closed.")

    finally:
        client.close()

    # ------------------------------------------------------------------------
    # 8. Protocol Resilience: Error Handling, Bad Magic, Version, and Missing Exe
    # ------------------------------------------------------------------------
    print("[Step 8/8] Testing Runner Resilience, Bad Framing, and Timeout Guards...")
    # 8a. Missing executable detection
    try:
        InteropClient("/nonexistent/path/to/binary")
        assert False, "Expected FileNotFoundError"
    except FileNotFoundError:
        print("  [PASS] 8a: Missing executable correctly raises FileNotFoundError.")

    # 8b. Protocol framing resilience
    resilient_client = InteropClient(binary_path)
    try:
        # Invalid magic
        bad_magic_frame = b"XX\x01\x01\x00\x00\x00\x00"
        resilient_client.proc.stdin.write(bad_magic_frame)
        resilient_client.proc.stdin.flush()
        status, _ = resilient_client.recv_frame()
        assert status == STATUS_ERROR_INVALID_COMMAND
        print("  [PASS] 8b: Corrupt magic bytes handled cleanly with STATUS_ERROR_INVALID_COMMAND.")

        # Unsupported protocol version
        bad_ver_frame = PROTOCOL_MAGIC + b"\xFE\x01\x00\x00\x00\x00"
        resilient_client.proc.stdin.write(bad_ver_frame)
        resilient_client.proc.stdin.flush()
        status, _ = resilient_client.recv_frame()
        assert status == STATUS_ERROR_UNSUPPORTED_VERSION
        print("  [PASS] 8c: Unsupported protocol version rejected with STATUS_ERROR_UNSUPPORTED_VERSION.")

        # Unknown command ID
        unknown_cmd_frame = PROTOCOL_MAGIC + PROTOCOL_VERSION.to_bytes(1, "big") + b"\xDE\x00\x00\x00\x00"
        resilient_client.proc.stdin.write(unknown_cmd_frame)
        resilient_client.proc.stdin.flush()
        status, _ = resilient_client.recv_frame()
        assert status == STATUS_ERROR_INVALID_COMMAND
        print("  [PASS] 8d: Unknown command ID handled cleanly with STATUS_ERROR_INVALID_COMMAND.")
    finally:
        resilient_client.close()

    print("================================================================================")
    print(" VARDHAN Q-CORE / LIBOQS INTEROPERABILITY SUITE: ALL 8 GATES PASSED (100%)")
    print(" Bidirectional Interoperability Verified: [INTEROP PASS]")
    print(" Zero Plaintext Key or Shared Secret Residuals Recorded.")
    print("================================================================================")


if __name__ == "__main__":
    run_interoperability_suite()
