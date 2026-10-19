# Release Verification Guide

This project strictly adheres to SLSA Level 3 provenance generation and Sigstore/Cosign keyless signature signing. Release artifacts are immutable, and their provenance can be independently verified.

## 1. Verifying Artifact Signatures (Sigstore / Cosign)

Every release contains a `.tar.gz` archive and a corresponding `.sig` signature file, signed via GitHub Actions OIDC integration. 

To verify the signature, install [Cosign](https://docs.sigstore.dev/cosign/installation/), download the release files (`zk-proof-engine-release.tar.gz` and `release.sig`), and run:

```bash
cosign verify-blob \
  --certificate-identity-regexp "^https://github\.com/vishnuvardhanburri/zk-proof-engine/\.github/workflows/release\.yml@refs/tags/v.*$" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  --signature release.sig \
  zk-proof-engine-release.tar.gz
```

## 2. Verifying the SBOM (CycloneDX)

The release contains `sbom.json` which has a detailed graph of all NPM dependencies. It is also signed via Cosign.

```bash
cosign verify-blob \
  --certificate-identity-regexp "^https://github\.com/vishnuvardhanburri/zk-proof-engine/\.github/workflows/release\.yml@refs/tags/v.*$" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  --signature sbom.sig \
  sbom.json
```

## 3. Verifying SLSA Provenance

The build process generates a cryptographically unforgeable SLSA Level 3 attestation using `slsa-github-generator`. This ensures that the build environment (`ubuntu-latest` on GitHub Actions) was completely isolated and that the artifact traces back directly to the source commit without tampering.

To verify the provenance, download the `.intoto.jsonl` attestation file and use the official [slsa-verifier](https://github.com/slsa-framework/slsa-verifier):

```bash
slsa-verifier verify-artifact zk-proof-engine-release.tar.gz \
  --provenance-path multiple.intoto.jsonl \
  --source-uri github.com/vishnuvardhanburri/zk-proof-engine
```

## 4. Manual Artifact Hashing

You can manually verify that the release tarball matches the expected SHA-256 hash output provided in the GitHub Release notes:

```bash
sha256sum zk-proof-engine-release.tar.gz
```
