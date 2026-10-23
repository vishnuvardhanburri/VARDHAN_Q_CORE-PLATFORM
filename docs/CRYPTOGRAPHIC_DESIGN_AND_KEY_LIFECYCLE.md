# Cryptographic design and key lifecycle

Status: implementation and internal tests only; independent review and certification
are **NOT ESTABLISHED**. No algorithm or parameter set was replaced in this patch.

| Primitive | Locked implementations | Intended standard/format | Validation and limitations |
|---|---|---|---|
| ML-KEM-1024 | ml-kem 0.2.3 | FIPS 203; raw encoded KEM key/ciphertext | typed length checks; full handshake security is separate |
| ML-DSA-87 | fips204 0.4.6; fips204 0.1.2 also in graph; pqcrypto-mldsa 0.1.2 receipt path | FIPS 204; raw keys/signatures, hex in envelopes | exact lengths and boolean verify; multiple implementations need independent interoperability |
| Ed25519 | ed25519-dalek 2.2.0 | RFC 8032; 32-byte public key, 64-byte signature | ISO V2 uses verify_strict; trusted registry required |
| HKDF | hkdf 0.12.4 | RFC 5869 construction; SHA-256 sessions / SHA3-512 transaction KDF | input encoding and context are protocol responsibilities |
| BLAKE3 | blake3 1.8.7 | BLAKE3 digest, 32 bytes/hex | integrity commitment, not authorization or uniqueness by itself |
| SHA-256 | sha2 0.10.9 / 0.11.0 | FIPS 180-4; finding content-hash hex | finding gate checks syntax, not evidence bytes |
| SHA3 | sha3 0.10.9 / 0.11.0 | FIPS 202 | KDF/self-test uses; not a module certificate |

Randomness comes from OS-backed rand::OsRng / library default RNG where used.
Internal POST/PCT tests exist. They are not independent known-answer/interoperability
certification. Inventory duplicate versions through Cargo.lock before any upgrade.
Cryptographic upgrades require vector, serialization, key persistence, signature and
cross-version tests, reviewed migration and deprecation; do not silently regenerate keys.

## Handshake

`proxy_engine` signs version advertisements and the encapsulation key; the insecure
legacy key-only verification fallback was removed. Frame lengths are exact. Existing
registry checks and AEAD transcript-derived directional keys remain. Older peers
that omit version authentication are intentionally incompatible. Registry-free APIs
are development mechanisms. Peer role, expiry/revocation propagation, role-specific
transcript authentication, replay/resumption, forward secrecy and downgrade resistance
of the complete protocol still require independent review. No new key-exchange protocol
was invented to fill those gaps; use a reviewed authenticated transport for deployment.

## Transaction derivation

KDF domain changes from V1 to V2. Salt is domain tag plus epoch BE64; info is purpose
tag, message ID BE64, context length BE64, context, transaction ID length BE64 and ID.
This repairs reproducible `(ab,c)` / `(a,bc)` ambiguity. Outputs change; retire affected
sessions and negotiate a coordinated rollout. Production callers were not found outside
module tests. This is domain separation, not server-side single-use enforcement. Durable
usage reservation tied to authenticated tenant/operation/session remains required.

## Key lifecycle and custody

Institutional registry supports status and expiry, but not a complete tenant/application/
role enrollment and audited key history. Rotation must require authenticated approval,
new-key possession proof, bounded overlap, revocation distribution and receipt archival
verification policy. Missing/expired trust data must deny new transactions.
Software vaults, AWS KMS adapters and test protectors coexist. A mock protector or device
presence is not HSM custody. The enclave executor now fails explicitly because its former
implementations returned unchanged input for every device state. No hardware operation
is claimed. Actual production HSM/Vault/KMS provisioning and independent attestation
remain external prerequisites.

`StoredIdentity` already zeroizes on drop. Malformed signing/KEM secret lengths now return
errors before key reconstruction. Zeroizing buffers reduce lifetime; compiler fences do
not erase all RAM/registers. Restrict core dumps, diagnostics, swap, ptrace and host access;
verify crash/backup policies and minimise copies. These host controls were not deployed.

## Epochs and recovery

The local controller quarantines an epoch, allocates fresh state and advances the epoch.
A poisoned quarantine lock now returns quarantined, denying new work. It does not prove
anomaly detection or safe continuation of established sessions. Required operational
states: healthy → isolated/quarantined → retired → fresh establishment → verified recovery,
with bounded retries and terminal isolation on timeout. Timeout must never restore trust.
No latency benchmark was run; historical ~280 µs claims are not reproduced. Measure
quarantine, fresh establishment and service recovery separately with hardware, samples,
concurrency, p50/p95/p99/max and failure counts before publishing a performance claim.
