#!/usr/bin/env python3
"""Validate timestamped artifacts from the local Docker PoV runner."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def latest(results_dir: Path, pattern: str) -> Path:
    matches = sorted(results_dir.glob(pattern))
    if not matches:
        fail(f"missing artifact matching {pattern}")
    return matches[-1]


def load_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot load valid JSON from {path.name}: {exc}")


def main() -> int:
    if len(sys.argv) != 2:
        fail("usage: verify_results.py scripts/qcore-pov/results")

    results_dir = Path(sys.argv[1]).resolve()
    if not results_dir.is_dir():
        fail(f"results directory does not exist: {results_dir}")

    security_path = latest(results_dir, "security_results_*.json")
    security = load_json(security_path)
    if not isinstance(security, dict):
        fail("security result must be a JSON object")
    total = int(security.get("total", -1))
    passed = int(security.get("passed", -1))
    failed = int(security.get("failed", -1))
    if total != 24:
        fail(f"expected 24 current security assertions, got {total}")
    if failed != 0 or passed != total:
        fail(f"security assertions did not all pass: passed={passed}, failed={failed}")

    perf_path = latest(results_dir, "perf_results_*.json")
    perf = load_json(perf_path)
    if not isinstance(perf, list) or not perf:
        fail("performance results must be a non-empty JSON array")

    required_levels = {1, 10, 50, 100}
    observed_levels = set()
    for result in perf:
        if not isinstance(result, dict):
            fail("performance result entry is not an object")
        label = str(result.get("label", "<unnamed>"))
        try:
            concurrency = int(result["concurrency"])
            requested = int(result["requests"])
            measured = int(result["measured_requests"])
            successes = int(result["successes"])
            errors = int(result["errors"])
            warmup_failures = int(result.get("warmup_failures", 0))
            observed = int(result["max_concurrent_requests_observed"])
            duration = float(result["measured_duration_seconds"])
            throughput = float(result["throughput_requests_per_second"])
            success_throughput = float(result["throughput_successes_per_second"])
            p50 = float(result["latency_p50_ms"])
            p95 = float(result["latency_p95_ms"])
            p99 = float(result["latency_p99_ms"])
        except (KeyError, TypeError, ValueError) as exc:
            fail(f"{label}: missing or invalid performance field: {exc}")

        observed_levels.add(concurrency)
        minimum_sample = max(100, concurrency * 10)
        if requested < minimum_sample:
            fail(f"{label}: only requested {requested} samples; require at least {minimum_sample}")
        if measured != requested:
            fail(f"{label}: measured {measured} of {requested} requested operations")
        if successes != requested or errors != 0 or warmup_failures != 0:
            fail(
                f"{label}: successes={successes}/{requested}, errors={errors}, "
                f"warmup_failures={warmup_failures}"
            )
        if duration <= 0 or throughput <= 0 or success_throughput <= 0:
            fail(f"{label}: invalid wall-clock throughput or duration")
        if not (p50 <= p95 <= p99):
            fail(f"{label}: percentiles are not ordered p50 <= p95 <= p99")
        if observed < max(1, math.ceil(concurrency * 0.75)):
            fail(
                f"{label}: requested concurrency {concurrency}, but observed maximum "
                f"was {observed} (minimum required is {math.ceil(concurrency * 0.75)}); "
                "this run did not demonstrate the requested parallelism"
            )

        target = result.get("payload_size_target_bytes")
        actual = result.get("payload_size_bytes")
        target_met = result.get("payload_size_target_met")
        if target is not None:
            if not isinstance(actual, int) or actual <= 0:
                fail(f"{label}: actual serialized request-body size is missing")
            # The required schema may exceed a 1 KB target; that case is reported
            # rather than silently labelled as an exact 1 KB payload. Larger targets
            # must be matched exactly.
            if int(target) > 1024 and target_met is not True:
                fail(f"{label}: requested payload target {target} bytes was not achieved")
            if int(target) == 1024 and target_met is False:
                print(
                    f"WARN: {label} mandatory schema exceeds 1 KiB target; "
                    f"actual body size is {actual} bytes"
                )

    if not required_levels.issubset(observed_levels):
        fail(f"performance results missing concurrency levels: {sorted(required_levels - observed_levels)}")

    crypto_path = latest(results_dir, "crypto_results_*.json")
    load_json(crypto_path)

    environment_path = latest(results_dir, "environment_*.txt")
    environment = environment_path.read_text(encoding="utf-8", errors="replace")
    for required_text in ("Source Git HEAD:", "Docker version:", "Docker image"):
        if required_text not in environment:
            fail(f"environment metadata is missing {required_text!r}")

    stats_path = latest(results_dir, "docker_stats_*.csv")
    stat_lines = [line for line in stats_path.read_text(encoding="utf-8", errors="replace").splitlines() if line.strip()]
    if len(stat_lines) < 2:
        fail("Docker stats artifact contains no resource samples")

    print(f"PASS: {total}/{total} security assertions")
    print(f"PASS: {len(perf)} performance cases; sample count, errors, throughput, percentiles, and concurrency checked")
    print(f"PASS: cryptographic JSON, environment metadata, and Docker resource samples exist")
    print(f"Artifacts: {security_path.name}, {perf_path.name}, {crypto_path.name}, {environment_path.name}, {stats_path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
