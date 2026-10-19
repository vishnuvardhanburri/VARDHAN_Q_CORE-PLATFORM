# P1 Threat Model

**Scope:** control plane, Q-Core receipt boundary, enterprise identity, SDKs, and tenant data plane.

## Trust zones

1. **Untrusted intelligence input** — `VerifiedFindingContract` and external evidence references.
2. **Q-Core sealing boundary** — trust-boundary validation, authority evaluation, canonicalization, hashing and dual signatures.
3. **Authenticated transport** — service identity + timestamp + nonce + HMAC-SHA256.
4. **Control plane** — tenant authorization, issuer-key registry, receipt verification and persistent state.
5. **Enterprise identity plane** — password/session, OIDC, SAML, WebAuthn and SCIM.
6. **SDK/client zone** — potentially stale or malicious clients; server remains authoritative.

## Primary threats

| Threat | Required control | Current evidence | Gate |
|---|---|---|---|
| Cross-tenant data access | Tenant-bound authorization on every resource | Organization membership and tenant fields are implemented | Add systematic negative cross-tenant tests |
| Forged receipt | Issuer registry + Ed25519 + ML-DSA-87 verification | Implemented in control-plane receipt verification | Add mutation/failure corpus |
| Receipt replay | Transport nonce/timestamp + SAML replay cache + transaction idempotency | Implemented in relevant boundaries | Add end-to-end replay tests |
| Signature substitution | Registered key IDs/fingerprint must match signed receipt | Implemented | Add wrong-key and rotated-key vectors |
| Canonicalization ambiguity | Deterministic canonical payload before hashing/signing | Implemented | Freeze canonical test vectors |
| Session replay | Token rotation and server-side session invalidation | Rotation implemented; contract test updated | Explicit old-token rejection test |
| Bootstrap credential leakage | File-based bootstrap secret, no long-lived env fallback | CI migrated to password file | Negative legacy-env test |
| SAML XML signature wrapping | Strict signed response validation and pinned metadata trust | `saml-rs` strict validation implemented | Adversarial regression suite |
| OIDC token confusion | PKCE/state/nonce + issuer/audience/expiry + JWKS | Implemented | Adversarial regression suite |
| WebAuthn ceremony replay | Durable challenge state + assertion verification | Implemented | Explicit challenge-reuse/origin/RP-ID tests |
| SCIM unauthorized provisioning | Bearer authentication + tenant lifecycle authorization | Implemented | Cross-tenant negative tests |
| SDK request replay | Idempotency keys on mutating operations | Helpers exist in multiple SDKs | Complete SDK inventory |

## Security principle

The control plane is authoritative. Client-side/UI state, SDK behavior, and intelligence-plane claims cannot grant authorization. Cryptographic receipt verification occurs after tenant and issuer binding, not as a substitute for authorization.
