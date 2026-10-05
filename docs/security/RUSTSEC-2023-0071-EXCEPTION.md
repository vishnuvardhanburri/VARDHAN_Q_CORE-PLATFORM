# RUSTSEC-2023-0071 Security Exception

**Advisory:** RUSTSEC-2023-0071 / CVE-2023-49092  
**Crate:** rsa 0.9.10  
**Status:** No patched version is currently published according to RustSec.

## Dependency path

The dependency enters through the SAML implementation stack (`saml-rs` → `bergshamra` → `rsa`).

## Applicability

The Vardhan Q-Core cryptographic transaction and receipt paths do not use RSA private-key decryption. Q-Core uses its Ed25519 + ML-DSA-87 receipt verification boundary and ML-KEM-1024 AER-KEP-Q path.

The SAML integration is an authentication/signature-verification boundary. It does not expose an RSA private-key decryption oracle.

## Compensating controls

- SAML IdP metadata is pinned to an operator-supplied trusted certificate.
- SAML assertions are verified by the SAML library before identity mapping.
- Replay protection is persisted atomically in the control-plane store.
- Tenant membership and authoritative authorization profiles are checked before session issuance.
- Q-Core receipt signing/verification remains independent of the SAML dependency.
- Production use of RSA private-key operations through the affected dependency is prohibited by architecture.

## Release handling

This is a bounded, reviewed dependency exception, not a generic audit suppression. Revisit immediately when RustSec publishes a patched RSA release or when the SAML dependency can migrate away from the affected RSA implementation.

Reference: https://rustsec.org/advisories/RUSTSEC-2023-0071.html
