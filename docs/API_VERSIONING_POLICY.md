# Vardhan Technologies API Versioning Policy

## Canonical contract

`api/openapi.yaml` is the canonical contract for the enterprise control-plane API.
The current public version is `/api/v1`.

## Compatibility rules

- Additive response fields and optional request fields are backward compatible.
- Removing or renaming a field, changing its type, changing authentication semantics, or changing authorization/entitlement behavior is breaking.
- Breaking changes require a new major API version (`/api/v2`, etc.).
- Existing major versions remain supported for the published deprecation window communicated to customers.
- Security fixes may change behavior immediately when required to prevent unauthorized access, entitlement bypass, data exposure, or unsafe cryptographic operation.

## Deprecation

Deprecated endpoints and fields must be documented in the OpenAPI description and release changelog.
Customers receive migration guidance before planned retirement. SDKs preserve the same major API boundary and must not silently fall back to deprecated endpoints.

## SDK compatibility

Official SDKs must:

- target the canonical OpenAPI version;
- expose typed request/response models where the SDK language supports them;
- preserve server request IDs in API errors;
- support bounded retries for rate limits/transient failures;
- support idempotency keys on mutating operations;
- support caller-supplied correlation IDs;
- never log bearer tokens, webhook secrets, or private key material.

## Entitlement security

Client-selected plans are never authoritative. Commercial feature access is determined by verified server-side subscription state. SDKs must treat entitlement responses as advisory capability data and rely on API authorization for enforcement.
