# @vardhan-technologies/sdk

Official TypeScript/Node.js SDK for the Vardhan Technologies enterprise control plane.

## Contract

The SDK follows `api/openapi.yaml`. It never treats browser-local state as authoritative and does not contain demo credentials.

## Example

```ts
import { Vardhan } from '@vardhan-technologies/sdk';

const vardhan = new Vardhan({
  baseUrl: process.env.VARDHAN_API_URL!,
  token: process.env.VARDHAN_API_TOKEN!,
});

const { organizations } = await vardhan.organizations.list();
const posture = await vardhan.organizations.entitlements(organizations[0].id);
```

The client includes bounded retry handling for rate limits/transient server failures, request timeouts, typed API errors and server request IDs.

Production applications should obtain credentials from their approved identity/secret-management boundary. Do not hard-code tokens.
