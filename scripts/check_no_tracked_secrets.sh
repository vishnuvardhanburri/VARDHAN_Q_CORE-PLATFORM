#!/bin/bash
# check_no_tracked_secrets.sh — Phase 1 non-destructive guard.
# Fails if credential-adjacent paths are TRACKED in git.
# Read-only: runs `git ls-files` only; never modifies the index/worktree.
set -euo pipefail

FAIL=0

# Each entry: "<git-ls-files pattern> <human label>".
# README/.gitkeep files are allow-listed so the guard does not flag docs.
check_tracked() {
  pattern="$1"
  label="$2"
  matches="$(git ls-files -- "$pattern" || true)"
  # Exclude allow-listed placeholders from the verdict.
  filtered="$(printf '%s\n' "$matches" | grep -v -e 'README\.md$' -e '\.gitkeep$' || true)"
  if [ -n "$filtered" ]; then
    echo "FAIL: tracked $label:"
    printf '%s\n' "$filtered"
    FAIL=1
  else
    echo "PASS: no tracked $label"
  fi
}

check_tracked '*/admin_password.txt' 'admin_password.txt files'
check_tracked '.admin_password' 'legacy .admin_password files'
check_tracked 'lab_keys/*' 'lab_keys/ contents'
check_tracked '*.pem' '*.pem files'
check_tracked '*.key' '*.key files'

if [ "$FAIL" -ne 0 ]; then
  echo "GUARD RESULT: FAIL — tracked secret-adjacent files present (rotation + purge decision required; see docs/SECURITY_FINDINGS_REGISTER.md)."
  exit 1
fi

echo "GUARD RESULT: PASS — no tracked secret-adjacent files."
