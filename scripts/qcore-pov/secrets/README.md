# secrets/ — IGNORED directory (no real secrets committed)

This directory is listed in the root `.gitignore`
(`scripts/qcore-pov/secrets/`, `**/admin_password.txt`) so that local
lab-only credential files are never committed.

Rules:

- Do NOT commit any file in this directory (except this README).
- At runtime the admin password MUST come from the environment or the
  deployment secret manager (e.g. Docker secret mounted at
  `/run/secrets/admin_password`, or `VARDHAN_ADMIN_PASSWORD_FILE`
  pointing at a runtime-provisioned file). See
  `scripts/qcore-pov/docker-compose.yml` (`secrets:` → `admin_password`)
  and `scripts/qcore-pov/entrypoint.sh`.
- Any value previously committed to git history is considered COMPROMISED:
  rotation is required, plus a history purge decision
  (`git filter-repo` / BFG) with owner approval before release.
- Details: `docs/SECURITY_FINDINGS_REGISTER.md` (S-01, S-04).
