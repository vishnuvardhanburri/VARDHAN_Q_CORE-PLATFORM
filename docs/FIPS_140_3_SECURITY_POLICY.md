# Vardhan Q-Core -- FIPS 140-3 Cryptographic Module Security Policy

## Document Control & Specification Metadata

- **Document Version:** 1.0.0
- **Classification:** Cryptographic Security Policy / Compliance Specification
- **Product:** Vardhan Q-Core Cryptographic Engine (`core_crypto`)
- **Applicable Standard:** NIST FIPS 140-3 (Security Requirements for Cryptographic Modules) / ISO/IEC 19790:2021
- **Target Security Levels:**
  - Overall Module Security: Level 1 (Software Multi-Chip Standalone Baseline)
  - Hardware Root of Trust Hybrid: Level 3 (when bound to external PKCS#11 HSM / Cloud KMS)
- **Approved PQC Baselines:** NIST FIPS 203 (ML-KEM), NIST FIPS 204 (ML-DSA), NIST SP 800-38D (AES-GCM), NIST FIPS 202 (SHA-3)

---

## 1. Cryptographic Module Specification & Boundary

### 1.1 Module Description
The Vardhan Q-Core Cryptographic Engine (`core_crypto`) is a software-hybrid multi-chip standalone cryptographic module designed to provide transaction submission validation, quantum-resistant receipt sealing, cryptographic key encapsulation, and evidence commitment verification for regulated institutional financial infrastructure.

### 1.2 Physical and Logical Cryptographic Boundaries
1. **Logical Boundary:** The software boundary encompasses the compiled `core_crypto` Rust library and its integration surfaces in `control_plane_api`. All application data, state transitions, and sensitive security parameters pass through explicit, strictly typed interfaces.
2. **Physical Boundary:** The physical boundary corresponds to the enclosure of the host server running a general-purpose enterprise operating system (e.g., Linux, hardened enterprise cloud VM, or bare-metal server).
3. **Hardware Enclave / HSM Hybrid Boundary:** When operating in hardware-backed deployment mode, private key protection and master wrapping delegate to physical HSM modules or cloud KMS appliances evaluated at FIPS 140-2 / FIPS 140-3 Level 3 via PKCS#11 (`backend/vardhan_keystore::kms::Pkcs11HsmProvider`).

---

## 2. Cryptographic Module Ports and Interfaces

The module maps all logical communication channels into the four mandatory FIPS 140-3 ports and interfaces:

| FIPS 140-3 Logical Interface | Physical / Network Mapping | Rust Module Interface Mapping | Description |
|---|---|---|---|
| **Data Input** | Network TCP sockets, internal memory buffers | Ingress JSON payloads, evidence commitments, encrypted envelopes, ciphertext blobs | Consumes transaction requests and verification evidence. |
| **Data Output** | Network TCP sockets, memory structures | Sealed receipts (`VardhanSealedReceipt`), shared keys, decrypted payloads | Outputs cryptographically sealed receipts and audit records. |
| **Control Input** | Environment variables, configuration files, HTTP endpoints | CLI arguments, `VARDHAN_FIPS_MODE`, rotation commands, key revocation calls | Controls lifecycle states and module operational mode. |
| **Status Output** | HTTP status codes, JSON telemetry, log streams | `/api/v1/crypto/fips-status`, `/api/v1/platform/health`, tracing structured logs | Emits module health, KAT verdicts, and error alerts. |

---

## 3. Roles, Services, and Authentication

### 3.1 Authorized Roles
1. **Crypto Officer (CO):** Responsible for module initialization, key generation, key rotation, emergency revocation, and inspection of self-test audit records.
2. **User (Application Operator):** Authorized to submit transaction payloads for verification and seal receipts under active key pairs.
3. **Verifier (Auditor / Third Party):** Authorized to query public keys and independently verify sealed receipts offline with zero write privileges.

### 3.2 Services Authorized by Role

| Service | Authorized Roles | Cryptographic Primitive / Algorithm | Description |
|---|---|---|---|
| **Run Self-Tests** | CO, User, Verifier | AES-GCM, SHA3, BLAKE3, Ed25519, ML-DSA-87, ML-KEM-1024 | Executes pre-operational Known Answer Tests (KAT). |
| **Key Generation** | CO | ML-DSA-87 (FIPS 204), ML-KEM-1024 (FIPS 203) | Generates new active node identity with Pairwise Consistency Tests. |
| **Key Rotation** | CO | ML-DSA-87, AES-256-GCM | Transitions active key to Deprecated/Retired and creates new active key. |
| **Key Revocation** | CO | State transition ledger | Flags compromised key as Revoked and alerts verifiers. |
| **Seal Receipt** | User | ML-DSA-87 + Ed25519 (Hybrid Dual-Signature) | Signs canonical transaction payload and generates verifiable receipt. |
| **Verify Receipt** | Verifier, User, CO | ML-DSA-87 (FIPS 204), Ed25519 (RFC 8032) | Performs standalone dual-signature cryptographic verification. |
| **Encapsulate KEM** | User, CO | ML-KEM-1024 (FIPS 203) | Encapsulates ephemeral shared secret with peer encapsulation key. |
| **Decapsulate KEM** | User, CO | ML-KEM-1024 (FIPS 203) | Decapsulates shared secret with private decapsulation key. |
| **Zeroize SSPs** | CO, System (on Error) | In-place memory overwrite (`zeroize`) | Shreds all plaintext keys and transient buffers from RAM. |

---

## 4. Cryptographic Algorithm Table & Modes of Operation

### 4.1 FIPS-Approved and Allowed Algorithms

| Algorithm | Standard | Specification | Mode / Parameter | Security Strength |
|---|---|---|---|---|
| **AES-GCM** | NIST SP 800-38D | Authenticated Encryption | AES-256-GCM, 96-bit Nonce, 128-bit Tag | 256 bits |
| **SHA3-512** | NIST FIPS 202 | Cryptographic Hash | Permutation-based sponge function | 256 bits (collision) |
| **ML-DSA-87** | NIST FIPS 204 | Post-Quantum Digital Signature | Parameter set Category 5 (Dilithium5) | 256 bits (Category 5) |
| **ML-KEM-1024** | NIST FIPS 203 | Key Encapsulation Mechanism | Parameter set Category 5 (Kyber1024) | 256 bits (Category 5) |
| **BLAKE3** | Specification | Cryptographic Hash (Allowed) | 256-bit tree hash | 256 bits |
| **Ed25519** | RFC 8032 | Classical Signature (Allowed in Hybrid) | PureEd25519 (SHA-512 + Curve25519) | 128 bits |

---

## 5. Sensitive Security Parameter (SSP) Management

### 5.1 Sensitive Security Parameters
- **ML-DSA-87 Private Key:** 4,896 bytes of lattice coefficient secrets.
- **ML-KEM-1024 Decapsulation Key:** 3,168 bytes of secret polynomial data.
- **Ed25519 Private Seed:** 32 bytes of entropy.
- **AES-256 Data Encryption Keys (DEK):** Ephemeral 256-bit symmetric keys.
- **Master Key Encryption Keys (KEK):** Wrapped in external HSM/Vault or derived via PBKDF2/Argon2.

### 5.2 Key Generation and Random Number Generation
- All random material is sourced from the underlying operating system entropy pool (`rand::rngs::OsRng`), compliant with NIST SP 800-90B requirements.
- Key generation routines execute immediate **Pairwise Consistency Tests (PCT)** before keys can be marked active.

### 5.3 Key Storage and Protection
- In production, private keys are never stored in plaintext on disk or in database records.
- Keys are wrapped in AES-256-GCM envelopes (`EncryptedEnvelope`) or maintained within the secure boundary of an attached PKCS#11 HSM.

### 5.4 Key Zeroization
- Memory containing sensitive key material is wrapped in zeroizing containers (`zeroize::Zeroizing` / `SecureKeyMaterial`).
- Upon deallocation, destruction, or transition into the FIPS error state, memory buffers are actively overwritten with zeroes to prevent memory scraping or core dump leakage.

---

## 6. Self-Test Requirements & Failure Behavior

### 6.1 Pre-Operational Power-On Self-Tests (POST)
Before the module enters the `Operational` state, it automatically executes Known Answer Tests (KAT) covering every approved algorithm:

1. **AES-256-GCM KAT:** Evaluates NIST SP 800-38D CAVP test vector; verifies ciphertext, authentication tag, and plaintext recovery.
2. **SHA3-512 KAT:** Evaluates NIST FIPS 202 standard test vector on standard byte inputs.
3. **BLAKE3 KAT:** Evaluates official BLAKE3 test vectors on empty and standard string inputs.
4. **Ed25519 KAT:** Evaluates RFC 8032 Section 7.1 test vector; verifies public key derivation, signature, and negative corruption rejection.
5. **ML-DSA-87 KAT:** Generates test key pair, signs probe message, verifies signature, and verifies corruption rejection.
6. **ML-KEM-1024 KAT:** Generates test key pair, encapsulates and decapsulates shared secret, verifies shared secret equality, and confirms ciphertext tamper rejection.
7. **Module Integrity KAT:** Computes cryptographic digest across core parameter definitions to verify software image integrity.

### 6.2 Conditional Self-Tests
1. **Pairwise Consistency Test (PCT) -- Signature:** Executed every time an ML-DSA-87 or Ed25519 keypair is generated. Signs a test probe and verifies with the public key. If verification fails, the key is immediately destroyed.
2. **Pairwise Consistency Test (PCT) -- KEM:** Executed every time an ML-KEM-1024 keypair is generated. Encapsulates and decapsulates a test secret. If the secret differs, the key is destroyed.
3. **Continuous Random Number Generator Test (CRNGT):** Compares consecutive 32-byte blocks from the entropy source to detect stuck bit patterns or entropy source degradation.

### 6.3 Fail-Closed Error State
If any self-test or conditional test fails:
1. The module transitions immediately to `FipsModuleState::Error`.
2. All transient Sensitive Security Parameters (SSPs) are shredded via global zeroization.
3. All cryptographic services are inhibited; subsequent cryptographic function calls return `FipsError::ModuleInErrorState`.
4. The control plane API returns HTTP 503 Service Unavailable on `/api/v1/crypto/fips-status`.

---

## 7. Physical Security & Operational Environment

1. **Operational Environment:** General Purpose Operating System (GPOS) complying with FIPS 140-3 modifiable operational environment requirements. The module runs in containerized (Docker Debian 12 slim) or bare-metal Linux environments.
2. **Hardware Security Modules (HSMs):** To achieve FIPS 140-3 Level 3 assurance for physical root-of-trust, institutions attach external FIPS 140-3 Level 3 certified hardware (e.g., Thales Luna HSM, Utimaco, or AWS CloudHSM) via the PKCS#11 abstraction layer.

---

## 8. Cryptographic Module Validation Program (CMVP) Roadmap

Vardhan Technologies pursues a formal two-track certification strategy:

1. **Track 1 -- Algorithm Correctness (CAVP):**
   - Validation of ML-DSA-87 and ML-KEM-1024 implementations against NIST ACVP (Automated Cryptographic Validation Protocol) test vector suites.
   - CAVP certificate issuance for AES-GCM and SHA3.
2. **Track 2 -- Module Certification (CMVP):**
   - Submission of `core_crypto` under FIPS 140-3 to an accredited NVLAP laboratory (e.g., Leidos, atsec, or CygnaCom).
   - Module validation listing under the NIST Cryptographic Module Validation Program.
