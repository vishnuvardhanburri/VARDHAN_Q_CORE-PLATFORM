# P1 Identity Security Model

## Authentication layers

- Password authentication creates a server-side session.
- Successful authenticated requests may rotate the session token; clients must consume `Authorization-New-Token`.
- Logout removes the server-side session.
- OIDC uses authorization-code flow with PKCE, state and nonce, discovery/JWKS validation, issuer/audience/expiry checks, and optional controlled provisioning.
- SAML ACS uses strict SAML validation, signed metadata with pinned trust, replay-cache protection, and organization membership checks.
- WebAuthn/passkeys use persistent ceremony state and credential verification.
- SCIM is an authenticated enterprise directory lifecycle boundary.

## Authorization model

The control plane uses organization membership and role-aware authorization for organization resources. Cryptographic verification is not an authorization mechanism: a valid signature does not authorize access to another tenant.

## Required closure tests

### Session

1. Login returns a valid session.
2. Authenticated request rotates token where configured.
3. Previous token is rejected after rotation.
4. New token remains accepted.
5. Logout invalidates the active token.

### OIDC

Reject tokens/assertions with:

- wrong issuer;
- wrong audience;
- expired `exp`;
- invalid signature/key;
- state mismatch;
- nonce mismatch;
- missing required PKCE binding.

### SAML

Reject:

- unsigned or untrusted metadata;
- invalid assertion signature;
- issuer mismatch;
- audience mismatch;
- destination/recipient mismatch;
- expired/not-yet-valid assertion;
- replayed response;
- identity not mapped to the target organization unless controlled auto-provisioning is explicitly enabled.

### WebAuthn

Reject:

- reused challenge;
- wrong RP ID/origin;
- invalid authenticator assertion;
- unknown credential;
- expired ceremony state.

### SCIM

Reject unauthenticated requests and any provisioning/deprovisioning operation that is not authorized for the configured enterprise organization.

## Known auth-service caveat

The current legacy auth-service `extract_authenticated_user` maps a validated session to `AuthenticatedUser::new_admin(...)`. This is stronger privilege than a general role-bearing session model and prevents the current codebase from being treated as fully role-derived at that boundary. The dedicated control-plane organization/RBAC layer must remain the authoritative enterprise authorization boundary until this is reconciled.
