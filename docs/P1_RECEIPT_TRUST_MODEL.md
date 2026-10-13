# P1 Receipt Trust Model

## Canonical sealing path

```text
VerifiedFindingContract
        │
        ▼
TrustBoundaryValidator
        │
        ▼
VardhanTransaction + authority evaluation
        │
        ▼
Deterministic canonical payload
        │
        ▼
BLAKE3(payload)
        │
        ├── Ed25519 signature
        └── ML-DSA-87 signature
        │
        ▼
VardhanSealedReceipt
        │
        ▼
HMAC-SHA256 authenticated transport
        │
        ▼
Control Plane
        ├── tenant binding
        ├── issuer/service binding
        ├── key fingerprint/key-ID validation
        ├── Ed25519 verification
        └── ML-DSA-87 verification
```

## Canonicalization invariant

The signed canonical payload covers tenant ID, transaction ID, proposed action, policy ID/version, state hash field, evidence commitments, authority reference, decision and outcome code. The resulting BLAKE3 digest is the message signed by both cryptographic layers.

## Issuer registry invariant

A receipt is accepted only when its organization/service identity resolves to an active registered issuer whose Ed25519 and ML-DSA-87 public keys and fingerprint match the receipt metadata.

## Transport invariant

The receipt transport uses a canonical `{timestamp}.{nonce}.{body}` representation and HMAC-SHA256. Requests require service identity, secret, timestamp and nonce, and the serialized receipt is bounded in size. Tenant ID must match the organization path.

## Failure semantics

- Invalid trust-boundary input → rejected.
- Unauthorized decision → rejected before sealing.
- Missing transport configuration → publication is not attempted.
- Transport failure after sealing → receipt remains locally sealed but the HTTP gateway reports `SEALED_BUT_NOT_PUBLISHED` rather than falsely claiming publication.
- Invalid tenant/key/signature at the control plane → receipt rejected.

## Acceptance gap

The HTTP gateway path is wired from canonical producer to authenticated transport. The standalone `ValidateCanonical` CLI is an offline producer and prints the sealed receipt without transport publication. P1 evidence must not conflate these two paths.
