#!/usr/bin/env python3
"""Mission F bank-lab result collector (stdlib only, sanitized output).

Reads /work/results/<profile>.json (one per qcore profile) and prints a
PASS/FAIL summary table plus an aggregate verdict. Reads status codes,
counts, and version prefixes only — never secrets.
"""

from __future__ import annotations

import glob
import json
import os
import sys

PROFILES = ("hsbc", "jpmorgan", "lgt", "swift")


def main() -> int:
    results_dir = os.environ.get("BANKLAB_RESULTS_DIR", "/work/results")
    total_pass = 0
    total_fail = 0
    missing: list[str] = []
    print("== banklab summary ==")
    for profile in PROFILES:
        path = os.path.join(results_dir, f"{profile}.json")
        if not os.path.exists(path):
            missing.append(profile)
            print(f"[MISS] {profile}: no results file at {path}")
            continue
        with open(path, encoding="utf-8") as handle:
            doc = json.load(handle)
        summary = doc.get("summary", {})
        n_pass = int(summary.get("pass", 0))
        n_fail = int(summary.get("fail", 0))
        total_pass += n_pass
        total_fail += n_fail
        print(f"[{('PASS' if n_fail == 0 else 'FAIL')}] {profile}: {n_pass} PASS, {n_fail} FAIL")
        for check in doc.get("checks", []):
            print(f"    [{check.get('status')}] {check.get('category')}: {check.get('detail')}")
    extra = sorted(
        os.path.basename(p)
        for p in glob.glob(os.path.join(results_dir, "*.json"))
        if os.path.splitext(os.path.basename(p))[0] not in PROFILES
    )
    if extra:
        print(f"[WARN] unexpected result files ignored: {', '.join(extra)}")
    print(f"== aggregate: {total_pass} PASS, {total_fail} FAIL; missing={missing or 'none'} ==")
    if missing or total_fail:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
