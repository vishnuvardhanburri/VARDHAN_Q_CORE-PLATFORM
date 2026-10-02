# Security Policy

## Reporting a Vulnerability

Please do not disclose security vulnerabilities through public GitHub Issues.

Report vulnerabilities privately through GitHub Security Advisories / private vulnerability reporting.

Include:
- affected version or commit
- affected component
- reproduction steps
- security impact
- proof of concept, where appropriate

We will acknowledge valid vulnerability reports and coordinate remediation and disclosure.

## Supported Versions

Security fixes are applied to actively maintained releases.

## Disclosure

Security issues are handled privately until a fix or mitigation is available.

## Known Accepted Risks

- **snarkjs / circomlibjs dependencies**: The `snarkjs` package currently pulls in `ws` and `underscore` which flag high-severity vulnerabilities in dependency scanners. **This is an accepted risk.** These libraries are only utilized offline during the circuit compilation and proving phases within `circuit-lib`. They are **never** executed in the hot path of the `api` package, which is strictly responsible for verification and has zero dependency on `snarkjs`.
