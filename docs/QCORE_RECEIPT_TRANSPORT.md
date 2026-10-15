# Q-Core Receipt Transport

The canonical receipt producer publishes sealed receipts through the authenticated control-plane boundary.

## Required deployment configuration

- `VARDHAN_QCORE_TRANSPORT_URL` — control-plane base URL.
- `VARDHAN_QCORE_ORGANIZATION_ID` — organization bound to the producer process.
- `VARDHAN_QCORE_SERVICE_ID` — persistent issuer/service identity registered for that organization.
- `VARDHAN_QCORE_SERVICE_SECRET` — service transport secret delivered through the deployment secret boundary.
- `VARDHAN_QCORE_ISSUER_REGISTRY_JSON` — control-plane bootstrap material containing the public Ed25519 and ML-DSA-87 issuer keys and lifecycle state.

Private signing keys are not transported. The receipt contains key identifiers and an issuer fingerprint; the control plane resolves public verification material from its persistent registry.

## Wire authentication

The producer sends:

- `X-Vardhan-Transport-Version: 2`
- `X-Vardhan-Service-Id`
- `X-Vardhan-Timestamp` (milliseconds since Unix epoch)
- `X-Vardhan-Nonce` (unique per request)
- `X-Vardhan-Signature` (hex HMAC-SHA256)

Transport version 2 signs a domain-separated, length-prefixed sequence containing the protocol version, HTTP method, exact organization route, organization ID, service ID, timestamp, nonce, and the **raw request-body bytes**. This prevents a valid request signature from being reused after changing the route tenant or service identity, and avoids ambiguous delimiter/string-decoding representations. Version 1 signatures are not accepted by the v2 endpoint; upgrade the producer and control plane together.

The control plane rejects missing/unsupported protocol versions, invalid authentication, stale timestamps, duplicate nonces, oversized receipt bodies, unknown or inactive issuer identities, cross-tenant receipts, malformed receipts, and invalid Ed25519/ML-DSA-87 signatures. This HMAC transport check is separate from the receipt's Ed25519 + ML-DSA-87 signature verification.

## Operational publisher

`vardhan-receipt-publisher` reads exactly one canonical sealed receipt from stdin and publishes it using the above boundary. It requires `VARDHAN_QCORE_ORGANIZATION_ID` and the transport variables.

This publisher is a transport adapter and does not mint, modify, or re-sign receipts. The canonical producer remains responsible for receipt construction and persistent signing-key lifecycle.

## Completion gate

The enterprise completion matrix must remain unchecked for `Q-Core producer/service-to-service telemetry publishing` until the canonical successful transaction path invokes this publisher (or the equivalent in-process transport function) after receipt sealing and produces an end-to-end accepted/verified telemetry record.
