#!/usr/bin/env python3
"""Fail CI if the maintained rustls 0.23 line regresses below the Oct 2026 fix.

The lockfile may retain rustls 0.21.12 solely through the opt-in AWS KMS SDK
compatibility dependency graph. That legacy advisory is explicitly reported in
the audit exception policy; it is not accepted as a replacement for updating
the actively maintained rustls 0.23 line.
"""
from __future__ import annotations

import pathlib
import sys
import tomllib

LOCKFILE = pathlib.Path(__file__).resolve().parents[1] / "Cargo.lock"
MIN_PATCH = 46
LEGACY_ALLOWED = {"0.21.12"}


def main() -> int:
    try:
        lock = tomllib.loads(LOCKFILE.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        print(f"FAIL: cannot parse {LOCKFILE}: {exc}", file=sys.stderr)
        return 2

    versions = sorted(
        {
            package.get("version", "")
            for package in lock.get("package", [])
            if package.get("name") == "rustls"
        }
    )
    if not versions:
        print("FAIL: Cargo.lock has no rustls package entry", file=sys.stderr)
        return 1

    maintained: list[tuple[int, int, int, str]] = []
    invalid: list[str] = []
    for version in versions:
        parts = version.split(".")
        try:
            major, minor, patch = (int(parts[i]) for i in range(3))
        except (ValueError, IndexError):
            invalid.append(version)
            continue

        if major == 0 and minor == 23:
            if patch < MIN_PATCH:
                invalid.append(version)
            else:
                maintained.append((major, minor, patch, version))
        elif version not in LEGACY_ALLOWED:
            invalid.append(version)

    if not maintained:
        invalid.append("missing rustls 0.23.46+ maintained line")

    if invalid:
        print("FAIL: rustls lockfile policy violations:", file=sys.stderr)
        for version in sorted(set(invalid)):
            print(f"  - {version}", file=sys.stderr)
        print(
            "Expected rustls 0.23.46+; only legacy 0.21.12 is temporarily "
            "allowed for the opt-in AWS KMS compatibility dependency graph.",
            file=sys.stderr,
        )
        return 1

    print("PASS: maintained rustls 0.23 line is patched (>= 0.23.46).")
    if LEGACY_ALLOWED.intersection(versions):
        print(
            "NOTICE: rustls 0.21.12 remains in Cargo.lock for the opt-in AWS "
            "KMS dependency graph and is covered by the documented audit exception."
        )
    print("Locked rustls versions: " + ", ".join(versions))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
