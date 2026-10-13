# GitHub Security Controls Matrix — Layer 1 Foundation

**Repository**: [`https://github.com/vishnuvardhanburri/zk-proof-engine`](https://github.com/vishnuvardhanburri/zk-proof-engine)  
**Maintainer**: Vishnu Vardhan Burri ([@vishnuvardhanburri](https://github.com/vishnuvardhanburri))  
**Last Audited**: 2026-08-10

This document defines the GitHub repository security posture for `zk-proof-engine`. Every security control is explicitly status-tagged with one of:
- `CONFIGURED` — Fully defined and active in repository code / workflow files.
- `NOT CONFIGURED` — Not active or intentionally omitted for this layer.
- `REQUIRES GITHUB UI ACTION` — Requires explicit maintainer configuration in the GitHub web interface settings.

---

## 1. Security Controls Status Matrix

| # | Security Control | Status | Configuration Location & Details |
| :-: | :--- | :--- | :--- |
| **1** | **Secret Scanning** | `REQUIRES GITHUB UI ACTION` | Managed in **Settings → Code security & analysis**. Free for public repos, but requires UI toggle enablement. |
| **2** | **Secret Push Protection** | `REQUIRES GITHUB UI ACTION` | Managed in **Settings → Code security & analysis**. Prevents pushes containing secrets; requires UI toggle enablement. |
| **3** | **Gitleaks (Secret Gate)** | `CONFIGURED` | Configured in `.gitleaks.toml` and enforced in `.github/workflows/secret-scan.yml` via `gitleaks detect` with full git history scanning. |
| **4** | **Dependabot Security & Version Updates** | `CONFIGURED` | Configured in `.github/dependabot.yml` for `npm` and `github-actions` ecosystems on weekly schedule, assigned to `@vishnuvardhanburri`. |
| **5** | **Dependency Review Action** | `CONFIGURED` | Configured in `.github/workflows/dependency-review.yml` targeting PRs with immutable SHA pinning and `fail-on-severity: high`. |
| **6** | **CodeQL Static Analysis** | `CONFIGURED` | Configured in `.github/workflows/codeql.yml` targeting `javascript-typescript` (`build-mode: none`) with immutable SHA pinning. *(Solidity static analysis is performed via Slither in `contracts.yml`)*. |
| **7** | **GitHub Actions SHA Pinning** | `CONFIGURED` | All third-party GitHub Actions across `.github/workflows/*.yml` use immutable 40-character commit SHAs. |
| **8** | **Least-Privilege Workflow Permissions** | `CONFIGURED` | All workflows (`ci.yml`, `contracts.yml`, `gatekeeper.yml`, `secret-scan.yml`, `codeql.yml`, `dependency-review.yml`) set strict `permissions: contents: read` (or minimum required). |
| **9** | **CODEOWNERS Protection** | `CONFIGURED` | Defined in `.github/CODEOWNERS` mapping all critical components and catch-all `*` to sole maintainer `@vishnuvardhanburri`. |
| **10** | **Vulnerability Reporting Policy** | `CONFIGURED` | Documented in `SECURITY.md` referencing GitHub Private Vulnerability Reporting and maintainer contact `@vishnuvardhanburri`. |
| **11** | **Branch Protection Rules (`main`)** | `REQUIRES GITHUB UI ACTION` | Managed in **Settings → Branches**. Recommended settings documented below; requires UI setup on GitHub. |

---

## 2. GitHub UI Action Guide (Maintainer Checklist)

To complete the Layer 1 security posture, maintainer **[@vishnuvardhanburri](https://github.com/vishnuvardhanburri)** should execute the following actions in the GitHub web UI:

### A. Code Security & Analysis Settings
Go to `https://github.com/vishnuvardhanburri/zk-proof-engine/settings/security_analysis`:
1. **Enable Secret Scanning**: Click *Enable* under Secret scanning.
2. **Enable Push Protection**: Click *Enable* under Push protection.
3. **Enable Private Vulnerability Reporting**: Click *Enable* under Private vulnerability reporting.

### B. Branch Protection Rules for `main`
Go to `https://github.com/vishnuvardhanburri/zk-proof-engine/settings/branches`:
1. Click **Add branch protection rule** for `main`.
2. Check **Require a pull request before merging**.
3. Check **Require status checks to pass before merging**:
   - Require status check: `Lint, Typecheck, Test` (`CI`)
   - Require status check: `Build, Test, Fuzz, Invariants` (`Smart Contracts CI`)
   - Require status check: `Slither + Gas report` (`Smart Contracts CI`)
   - Require status check: `Gitleaks (secrets)` (`Secret Scan`)
   - Require status check: `zk-verify gate (signed proof + artifact binding + on-chain)` (`Gatekeeper`)
   - Require status check: `Analyze (javascript-typescript)` (`CodeQL`)
   - Require status check: `Dependency Review (vulnerability & license guard)` (`Dependency Review`)
4. Check **Require signed commits** (optional, recommended).
5. Check **Do not allow bypassing the above settings**.
