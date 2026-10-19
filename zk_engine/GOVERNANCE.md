# Governance

This document describes the governance model for `zk-proof-engine`. 

## Roles and Responsibilities

### Maintainers
Maintainers are responsible for the overall health, direction, and security of the repository. Maintainer responsibilities include:
- Reviewing and merging pull requests.
- Triaging issues and guiding the project's roadmap.
- Managing releases, cutting release tags, and signing release artifacts.
- Ensuring compliance with OpenSSF Best Practices and security policies.

*Current Maintainer(s):*
- [@vishnuvardhanburri](https://github.com/vishnuvardhanburri)

### Security Team
The Security Team is responsible for:
- Monitoring and triaging private vulnerability reports.
- Overseeing cryptographic design and review processes.
- Auditing supply chain integrity (e.g., SLSA provenance, dependency scanning).

*Current Security Team:*
- [@vishnuvardhanburri](https://github.com/vishnuvardhanburri)

### Contributors
Contributors are community members who:
- Submit bug reports, feature requests, and documentation improvements.
- Author pull requests in accordance with the [CONTRIBUTING.md](CONTRIBUTING.md).
- Help verify releases and participate in code review.

## Access Continuity and Bus Factor

Currently, this project is primarily maintained by a single owner (`@vishnuvardhanburri`). This represents a known "bus factor" of 1, meaning that if the primary maintainer is unavailable, project development and release capability will pause.

### Release Authority & Keys
- **Signing Keys:** Release artifacts are signed via Sigstore/Cosign. Currently, the authority to sign a release is restricted to the primary maintainer's identity.
- **NPM Publishing:** Automated via GitHub Actions, contingent upon the primary maintainer's authorization or branch protections.

### Contingency Plan
To mitigate the risks of a single-owner model, the following mitigations are in place:
1. **Automated CI/CD:** All releases, tests, and security scans are fully automated via GitHub Actions. No manual build steps are required.
2. **Reproducibility:** The repository provides full SBOMs, SLSA provenance, and deterministic build instructions so that any organization can fork, audit, and build the project independently.
3. **Future Expansion:** We intend to onboard additional maintainers to distribute release authority and increase the bus factor to a healthier level as the project matures.
