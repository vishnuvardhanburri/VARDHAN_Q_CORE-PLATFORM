# Contributing

We welcome contributions to `zk-proof-engine`! To ensure a secure and reliable supply chain, we adhere to OpenSSF Best Practices.

## OpenSSF Practices

When contributing, please follow these security guidelines:

1. **Immutable Dependencies**: Any new GitHub Action must be pinned to a full 40-character commit SHA.
2. **Least Privilege**: GitHub Actions workflows must use the minimum required `permissions`.
3. **No Shell Injection**: Avoid untrusted inputs in `run` blocks in workflows.
4. **Vulnerability Scanning**: Code additions must pass all OSV-Scanner and Scorecard supply-chain security checks.
5. **Testing**: Ensure all new code has accompanying tests. Run `npm test` and `forge test` locally before submitting a PR.
6. **Code Review**: All PRs require review before merging into `main`.

## Developer Certificate of Origin (DCO)

We enforce the Developer Certificate of Origin (DCO) on all pull requests. This requires that all commit messages contain the `Signed-off-by` line with an email address that matches the commit author. Please read the full text in [DCO.md](DCO.md).

To sign off your commits, use the `-s` flag with git commit:
```bash
git commit -s -m "feat: your feature"
```

## Local Development (Node & Foundry)

```bash
# Install dependencies
npm ci

# Build the project
npm run build

# Run the test suite
npm test
```

Please review the [SECURITY.md](SECURITY.md) for vulnerability reporting instructions.
