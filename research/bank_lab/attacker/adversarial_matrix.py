#!/usr/bin/env python3
"""Mission F bank-lab adversarial matrix runner (synthetic, local-only).

One deterministic runner, stdlib only. Exercises 10 adversarial categories
against a single qcore profile (``--profile hsbc`` etc.) over the isolated
``banklab`` bridge network and writes machine-readable JSON to
``/work/results/<profile>.json``.

Ground truth (verified by leader, do not re-derive):
- POST /api/v1/organizations {name} -> 201 (auth: Bearer session token).
- Session auth: POST /api/v1/auth/login {username,password} -> 200 {token};
  every response may carry ``Authorization-New-Token: Bearer <new>`` which
  MUST replace the current token (rotation defeats replay).
- Missing/invalid Bearer on protected routes -> 401 (fail-closed).
- Duplicate monitoring-signal identity: identical re-POST -> idempotent-same
  (202, same alert_id); conflicting content -> 400 rejected w/ conflict
  (SignalConflict maps to 400 at the HTTP layer, not 409).
- Cross-tenant validate: route org != contract org -> 403
  REJECTED_TENANT_MISMATCH (checked before the receipt engine runs).
- mTLS + restart-durability: covered by G3/G2 cargo tests; this runner
  asserts the live plaintext-health baseline + create/re-GET consistency and
  records the coverage pointers (host script verifies the test files exist).
- Vault dev (hostname ``vault``) provides the G4-analog rotation scenario.

Sanitization: synthetic lab-only credentials only; NOTHING secret is ever
printed or written (no passwords, no tokens, no ciphertext bodies — only
status codes, version prefixes, lengths, and counts).
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
import zlib
from typing import Any, Optional


# --------------------------------------------------------------------------
# HTTP helpers (urllib, stdlib only)
# --------------------------------------------------------------------------

class ApiResult:
    """Sanitized HTTP outcome: status, parsed JSON (or {}), rotated token."""

    def __init__(
        self,
        status: int,
        body: dict[str, Any],
        raw_ok: bool,
        new_token: Optional[str] = None,
    ) -> None:
        self.status = status
        self.body = body
        self.raw_ok = raw_ok
        self.new_token = new_token


class Client:
    """Minimal session-aware HTTP client with token-rotation tracking."""

    def __init__(self, base_url: str, timeout_s: float = 10.0) -> None:
        self.base = base_url.rstrip("/")
        self.timeout = timeout_s
        self.token: Optional[str] = None

    def _do(
        self,
        method: str,
        path: str,
        payload: Any = None,
        raw_body: Optional[bytes] = None,
        use_auth: bool = True,
        bearer_override: Optional[str] = None,
    ) -> ApiResult:
        url = self.base + path
        headers = {"Content-Type": "application/json"}
        bearer = bearer_override if bearer_override is not None else self.token
        if use_auth and bearer:
            headers["Authorization"] = "Bearer " + bearer
        if raw_body is not None:
            data: Optional[bytes] = raw_body
        elif payload is not None:
            data = json.dumps(payload).encode("utf-8")
        else:
            data = None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                status = resp.status
                new_token = _rotated_token(resp.headers)
                raw = resp.read()
        except urllib.error.HTTPError as exc:
            status = exc.code
            try:
                new_token = _rotated_token(exc.headers)
            except Exception:
                new_token = None
            try:
                raw = exc.read()
            except Exception:
                raw = b""
        except Exception as exc:  # connection refused / timeout: fail-closed signal
            return ApiResult(status=0, body={"transport_error": type(exc).__name__}, raw_ok=False)
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
            if not isinstance(body, dict):
                body = {"value": body}
        except Exception:
            body = {"non_json": True, "length": len(raw)}
        result = ApiResult(status=status, body=body, raw_ok=True, new_token=new_token)
        if new_token:
            self.token = new_token
        return result


def _rotated_token(headers: Any) -> Optional[str]:
    try:
        value = headers.get("Authorization-New-Token", "")
    except Exception:
        return None
    if isinstance(value, str) and value.startswith("Bearer "):
        rotated = value[7:].strip()
        return rotated or None
    return None


# --------------------------------------------------------------------------
# Matrix
# --------------------------------------------------------------------------

CHECK_ORDER = [
    "setup",
    "replay_duplicate",
    "tamper",
    "unauthorized_actor",
    "cross_tenant",
    "mtls_triple",
    "concurrent_duplicates",
    "restart_durability",
    "vault_rotation",
    "invalid_token",
    "malformed_evidence",
]


class Matrix:
    def __init__(self, profile: str, qcore_url: str, vault_url: str, org_name: str) -> None:
        self.profile = profile
        self.qcore = Client(qcore_url)
        self.vault_url = vault_url.rstrip("/")
        self.vault_token = os.environ.get("VAULT_TOKEN", "banklab-dev-root")
        self.timeout = 10.0
        self.org_name = org_name
        # Deterministic per-profile seed (crc32 is stable across runs).
        self.seed = zlib.crc32(("banklab-v1:" + profile).encode("utf-8")) & 0xFFFFFFFF
        self.rng = random.Random(self.seed)
        self.checks: list[dict[str, Any]] = []
        self.org_id = ""
        self.signal_seq = 0

    # -- bookkeeping ------------------------------------------------------
    def record(self, category: str, passed: bool, detail: str, evidence: dict[str, Any]) -> None:
        self.checks.append(
            {
                "category": category,
                "status": "PASS" if passed else "FAIL",
                "detail": detail,
                "evidence": evidence,
            }
        )
        print(f"[{'PASS' if passed else 'FAIL'}] {self.profile}/{category}: {detail}", flush=True)

    def passed(self, category: str, detail: str, evidence: dict[str, Any]) -> bool:
        self.record(category, True, detail, evidence)
        return True

    def failed(self, category: str, detail: str, evidence: dict[str, Any]) -> bool:
        self.record(category, False, detail, evidence)
        return False

    # -- fixtures ---------------------------------------------------------
    def _signal_body(self, tag: str) -> dict[str, Any]:
        self.signal_seq += 1
        nonce = self.rng.getrandbits(63)
        return {
            "signal_id": f"sig-{self.profile}-{tag}-{self.seed:08x}-{nonce:016x}",
            "source": "monitoring",
            "severity": "high",
            "title": f"Synthetic {tag} signal",
            "message": "Synthetic adversarial-matrix probe (no real data).",
            "evidence_refs": ["ev-synthetic-001"],
            "observed_at_ms": 1760000000000 + self.signal_seq,
        }

    def setup(self) -> bool:
        """Health baseline, login, org create, catalog sanity."""
        ok = True
        r = self.qcore._do("GET", "/api/v1/platform/health", use_auth=False)
        if r.status != 200 or "operational" not in json.dumps(r.body):
            return self.failed(
                "setup",
                f"health baseline unreachable (status={r.status})",
                {"health_status": r.status},
            )
        transport = r.body.get("transport", "unknown")
        user = os.environ.get("BANKLAB_ADMIN_USER", "admin")
        pw = os.environ.get("BANKLAB_ADMIN_PASS", "")
        r = self.qcore._do(
            "POST",
            "/api/v1/auth/login",
            payload={"username": user, "password": pw},
            use_auth=False,
        )
        token = r.body.get("token", "") if isinstance(r.body, dict) else ""
        if r.status != 200 or not token:
            return self.failed(
                "setup",
                f"login failed (status={r.status})",
                {"login_status": r.status},
            )
        self.qcore.token = token
        suffix = f"{self.seed:08x}"
        r = self.qcore._do(
            "POST", "/api/v1/organizations", payload={"name": f"{self.org_name} {suffix}"}
        )
        org = r.body.get("organization", {}) if isinstance(r.body, dict) else {}
        if r.status != 201 or not org.get("id"):
            return self.failed(
                "setup",
                f"org create failed (status={r.status})",
                {"create_status": r.status},
            )
        self.org_id = org["id"]
        r = self.qcore._do("GET", "/api/v1/catalog/plans", use_auth=False)
        if r.status != 200:
            ok = False
        self.record(
            "setup",
            ok and True,
            f"health=200 transport={transport} login=200 org=201 catalog={r.status}",
            {"transport": transport, "catalog_status": r.status},
        )
        return ok

    # -- (1) replay / duplicate -------------------------------------------
    def check_replay_duplicate(self) -> bool:
        body = self._signal_body("replay")
        path = f"/api/v1/organizations/{self.org_id}/security/alerts"
        first = self.qcore._do("POST", path, payload=body)
        second = self.qcore._do("POST", path, payload=body)
        if first.status != 202:
            return self.failed(
                "replay_duplicate",
                f"first ingest not accepted (status={first.status})",
                {"first_status": first.status},
            )
        first_id = (first.body.get("alert") or {}).get("alert_id", "")
        second_id = (second.body.get("alert") or {}).get("alert_id", "")
        # Accept 409-conflict-shaped OR idempotent-same (202 + identical id).
        if second.status == 409:
            return self.passed(
                "replay_duplicate",
                "duplicate rejected with 409 conflict",
                {"first_status": 202, "second_status": 409},
            )
        if second.status == 202 and second_id == first_id and first_id:
            return self.passed(
                "replay_duplicate",
                "duplicate idempotent-same (202, identical alert_id)",
                {"first_status": 202, "second_status": 202, "same_identity": True},
            )
        return self.failed(
            "replay_duplicate",
            f"duplicate neither 409 nor idempotent-same (second={second.status})",
            {"first_status": first.status, "second_status": second.status,
             "same_identity": second_id == first_id},
        )

    # -- (2) tamper ---------------------------------------------------------
    def check_tamper(self) -> bool:
        body = self._signal_body("tamper")
        path = f"/api/v1/organizations/{self.org_id}/security/alerts"
        raw = json.dumps(body).encode("utf-8")
        # Flip one byte inside the JSON string (deterministic position).
        pos = 10 % len(raw)
        flipped = bytearray(raw)
        flipped[pos] ^= 0x01
        r_flip = self.qcore._do("POST", path, raw_body=bytes(flipped))
        bad_enum = dict(body)
        bad_enum["severity"] = "nonsense-severity"
        r_enum = self.qcore._do("POST", path, payload=bad_enum)
        flip_4xx = 400 <= r_flip.status <= 499
        enum_4xx = 400 <= r_enum.status <= 499
        if flip_4xx and enum_4xx:
            return self.passed(
                "tamper",
                f"byte-flip -> {r_flip.status}, bad-enum -> {r_enum.status} (both 4xx)",
                {"flip_status": r_flip.status, "enum_status": r_enum.status},
            )
        return self.failed(
            "tamper",
            f"tampered payload not fail-closed (flip={r_flip.status}, enum={r_enum.status})",
            {"flip_status": r_flip.status, "enum_status": r_enum.status},
        )

    # -- (3) unauthorized actor -------------------------------------------
    def check_unauthorized_actor(self) -> bool:
        path = f"/api/v1/organizations/{self.org_id}/members"
        r = self.qcore._do("GET", path, use_auth=False)
        if r.status in (401, 403, 404):
            return self.passed(
                "unauthorized_actor",
                f"no-auth members access fail-closed ({r.status})",
                {"status": r.status},
            )
        return self.failed(
            "unauthorized_actor",
            f"no-auth members access NOT fail-closed (status={r.status})",
            {"status": r.status},
        )

    # -- (4) cross-tenant ---------------------------------------------------
    def check_cross_tenant(self) -> bool:
        r = self.qcore._do(
            "POST", "/api/v1/organizations", payload={"name": f"X-tenant Org {self.seed:08x}"}
        )
        org_b = (r.body.get("organization", {}) or {}).get("id", "")
        if r.status != 201 or not org_b:
            return self.failed(
                "cross_tenant",
                f"second-org setup failed (status={r.status})",
                {"second_create_status": r.status},
            )
        payload = {
            "contract": {"organization": {"organization_id": self.org_id}},
            "actor_workload_id": "svc:synthetic:probe",
        }
        r = self.qcore._do(
            "POST", f"/api/v1/organizations/{org_b}/security/validate", payload=payload
        )
        if 400 <= r.status <= 499:
            mismatch = r.body.get("status", "") == "REJECTED_TENANT_MISMATCH"
            return self.passed(
                "cross_tenant",
                f"cross-tenant validate fail-closed ({r.status}, mismatch_flag={mismatch})",
                {"status": r.status, "tenant_mismatch_flag": mismatch},
            )
        return self.failed(
            "cross_tenant",
            f"cross-tenant validate NOT fail-closed (status={r.status})",
            {"status": r.status},
        )

    # -- (5) mTLS triple ----------------------------------------------------
    def check_mtls_triple(self) -> bool:
        r = self.qcore._do("GET", "/api/v1/platform/health", use_auth=False)
        reachable = r.status == 200 and "operational" in json.dumps(r.body)
        transport = r.body.get("transport", "unknown") if reachable else "unreachable"
        # Plaintext baseline reachable; TLS-profile assertion runs in the G3
        # cargo test (backend/control_plane_api/tests/g3_mtls_handshake.rs).
        # Host script verifies that file exists.
        if reachable:
            return self.passed(
                "mtls_triple",
                f"plaintext health baseline reachable (transport={transport}); "
                "mTLS assertion covered-by-g3-cargo-test",
                {"health_status": r.status, "transport": transport,
                 "mtls_status": "covered-by-g3-cargo-test"},
            )
        return self.failed(
            "mtls_triple",
            f"health baseline unreachable (status={r.status})",
            {"health_status": r.status, "mtls_status": "covered-by-g3-cargo-test"},
        )

    # -- (6) concurrent duplicates -----------------------------------------
    def _login_token(self) -> Optional[str]:
        user = os.environ.get("BANKLAB_ADMIN_USER", "admin")
        pw = os.environ.get("BANKLAB_ADMIN_PASS", "")
        probe = Client(self.qcore.base, self.qcore.timeout)
        r = probe._do(
            "POST",
            "/api/v1/auth/login",
            payload={"username": user, "password": pw},
            use_auth=False,
        )
        if r.status == 200 and isinstance(r.body, dict) and r.body.get("token"):
            return r.body["token"]
        return probe.token

    def check_concurrent_duplicates(self) -> bool:
        body = self._signal_body("concurrent")
        path = f"/api/v1/organizations/{self.org_id}/security/alerts"
        tokens = [self._login_token() for _ in range(20)]
        if any(not t for t in tokens):
            return self.failed(
                "concurrent_duplicates",
                "per-thread login setup failed",
                {"logins_ok": sum(1 for t in tokens if t)},
            )

        def worker(tok: str) -> tuple[int, str]:
            cli = Client(self.qcore.base, self.qcore.timeout)
            cli.token = tok
            r = cli._do("POST", path, payload=body)
            alert_id = ""
            if isinstance(r.body, dict):
                alert_id = ((r.body.get("alert") or {}).get("alert_id", "")) or ""
            return r.status, alert_id

        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
            outcomes = list(pool.map(worker, tokens))  # type: ignore[arg-type]
        n_202 = sum(1 for s, _ in outcomes if s == 202)
        ids_202 = {i for s, i in outcomes if s == 202}
        others = sorted({s for s, _ in outcomes if s != 202})
        others_ok = all(s == 400 for s in others)  # conflict-shaped only
        if n_202 >= 1 and len(ids_202) == 1 and others_ok:
            detail = (
                f"20-way race: {n_202}x202 same-identity + "
                f"{20 - n_202}x400-conflict (exactly-one-identity)"
            )
            return self.passed(
                "concurrent_duplicates",
                detail,
                {"n_202": n_202, "distinct_success_identities": len(ids_202),
                 "other_statuses": others},
            )
        return self.failed(
            "concurrent_duplicates",
            f"race violated exactly-one-identity (202={n_202}, ids={len(ids_202)}, other={others})",
            {"n_202": n_202, "distinct_success_identities": len(ids_202),
             "other_statuses": others},
        )

    # -- (7) restart durability --------------------------------------------
    def check_restart_durability(self) -> bool:
        # Live substitute: create -> re-GET consistency. Real restart/persist
        # proof lives in the G2 cargo test (host script verifies the file).
        r = self.qcore._do("GET", f"/api/v1/organizations/{self.org_id}")
        org = r.body.get("organization", {}) if isinstance(r.body, dict) else {}
        consistent = r.status == 200 and org.get("id") == self.org_id
        if consistent:
            return self.passed(
                "restart_durability",
                "create/re-GET consistent; restart proof covered-by-g2-cargo-test",
                {"reget_status": r.status, "consistent": True,
                 "restart_proof": "covered-by-g2-cargo-test"},
            )
        return self.failed(
            "restart_durability",
            f"create/re-GET inconsistent (status={r.status})",
            {"reget_status": r.status, "consistent": False,
             "restart_proof": "covered-by-g2-cargo-test"},
        )

    # -- (8) vault rotation analog ------------------------------------------
    def _vault(self, method: str, path: str, payload: Any = None) -> tuple[int, dict[str, Any]]:
        # Synthetic lab-only dev token; only status codes and version prefixes
        # are ever logged or persisted — never headers or bodies.
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(
            self.vault_url + path,
            data=data,
            headers={"X-Vault-Token": self.vault_token, "Content-Type": "application/json"},
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
                return resp.status, (json.loads(raw.decode("utf-8")) if raw else {})
        except urllib.error.HTTPError as exc:
            return exc.code, {}
        except Exception as exc:
            return 0, {"transport_error": type(exc).__name__}

    def check_vault_rotation(self) -> bool:
        key = f"banklab-{self.profile}"
        s, _ = self._vault("POST", "/v1/sys/mounts/transit", {"type": "transit"})
        if s not in (204, 400):  # 400 = already mounted (idempotent setup)
            return self.failed(
                "vault_rotation",
                f"transit mount failed (status={s})",
                {"mount_status": s},
            )
        s, _ = self._vault("POST", f"/v1/transit/keys/{key}", {"exported": False})
        if s not in (204, 200, 400):  # 400 = key already exists
            return self.failed(
                "vault_rotation",
                f"transit key create failed (status={s})",
                {"key_create_status": s},
            )
        plaintext = base64.b64encode(
            f"synthetic-{self.profile}-{self.seed:08x}".encode("utf-8")
        ).decode("ascii")
        s1, b1 = self._vault("POST", f"/v1/transit/encrypt/{key}", {"plaintext": plaintext})
        ct1 = (b1.get("data") or {}).get("ciphertext", "")
        if s1 != 200 or not ct1:
            return self.failed(
                "vault_rotation",
                f"pre-rotate encrypt failed (status={s1})",
                {"encrypt_status": s1},
            )
        sr, _ = self._vault("POST", f"/v1/transit/keys/{key}/rotate")
        if sr not in (200, 204):
            return self.failed(
                "vault_rotation",
                f"key rotation failed (status={sr})",
                {"rotate_status": sr},
            )
        s2, b2 = self._vault("POST", f"/v1/transit/encrypt/{key}", {"plaintext": plaintext})
        ct2 = (b2.get("data") or {}).get("ciphertext", "")
        if s2 != 200 or not ct2:
            return self.failed(
                "vault_rotation",
                f"post-rotate encrypt failed (status={s2})",
                {"re_encrypt_status": s2},
            )
        # Ciphertext envelope is "vault:v<version>:<data>" — version is index 1.
        v1 = ct1.split(":")[1] if ct1.count(":") >= 2 else "?"
        v2 = ct2.split(":")[1] if ct2.count(":") >= 2 else "?"
        sd1, bd1 = self._vault("POST", f"/v1/transit/decrypt/{key}", {"ciphertext": ct1})
        sd2, bd2 = self._vault("POST", f"/v1/transit/decrypt/{key}", {"ciphertext": ct2})
        pt1 = ((bd1.get("data") or {}).get("plaintext", "")) if sd1 == 200 else ""
        pt2 = ((bd2.get("data") or {}).get("plaintext", "")) if sd2 == 200 else ""
        # Sanitized: compare only version prefixes + lengths + decrypt equality.
        differ = ct1 != ct2 and v1 != v2
        roundtrip = bool(pt1) and pt1 == pt2 == plaintext
        if differ and roundtrip:
            return self.passed(
                "vault_rotation",
                f"rotated {v1}->{v2}, ciphertext differs, both decrypt to same plaintext",
                {"pre_version": v1, "post_version": v2, "ciphertext_differs": True,
                 "decrypt_roundtrip": True, "ct_len_1": len(ct1), "ct_len_2": len(ct2)},
            )
        return self.failed(
            "vault_rotation",
            f"rotation analog failed (differ={differ}, roundtrip={roundtrip})",
            {"pre_version": v1, "post_version": v2, "ciphertext_differs": differ,
             "decrypt_roundtrip": roundtrip},
        )

    # -- (9) invalid token ----------------------------------------------------
    def check_invalid_token(self) -> bool:
        path = f"/api/v1/organizations/{self.org_id}/members"
        r = self.qcore._do("GET", path, bearer_override="banklab-invalid-token")
        if r.status in (401, 403):
            return self.passed(
                "invalid_token",
                f"bad bearer fail-closed ({r.status})",
                {"status": r.status},
            )
        return self.failed(
            "invalid_token",
            f"bad bearer NOT fail-closed (status={r.status})",
            {"status": r.status},
        )

    # -- (10) malformed evidence --------------------------------------------
    def check_malformed_evidence(self) -> bool:
        path = f"/api/v1/organizations/{self.org_id}/security/validate"
        r = self.qcore._do("POST", path, raw_body=b"not-json{{{garbage")
        if r.status in (400, 422):
            return self.passed(
                "malformed_evidence",
                f"garbage JSON rejected ({r.status})",
                {"status": r.status},
            )
        return self.failed(
            "malformed_evidence",
            f"garbage JSON NOT rejected with 400/422 (status={r.status})",
            {"status": r.status},
        )

    # -- driver ---------------------------------------------------------------
    def run(self) -> int:
        started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        print(f"== banklab matrix: profile={self.profile} seed={self.seed:08x} ==", flush=True)
        if not self.setup():
            self._write(started)
            return 1
        self.check_replay_duplicate()
        self.check_tamper()
        self.check_unauthorized_actor()
        self.check_cross_tenant()
        self.check_mtls_triple()
        self.check_concurrent_duplicates()
        self.check_restart_durability()
        self.check_vault_rotation()
        self.check_invalid_token()
        self.check_malformed_evidence()
        self._write(started)
        fails = sum(1 for c in self.checks if c["status"] == "FAIL")
        print(f"== {self.profile}: {len(self.checks) - fails} PASS, {fails} FAIL ==", flush=True)
        return 1 if fails else 0

    def _write(self, started_at: str) -> None:
        fails = sum(1 for c in self.checks if c["status"] == "FAIL")
        doc = {
            "profile": self.profile,
            "seed": f"{self.seed:08x}",
            "started_at": started_at,
            "qcore_url": self.qcore.base,
            "checks": self.checks,
            "summary": {
                "total": len(self.checks),
                "pass": len(self.checks) - fails,
                "fail": fails,
            },
        }
        out_dir = os.environ.get("BANKLAB_RESULTS_DIR", "/work/results")
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, f"{self.profile}.json")
        tmp = path + f".{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(doc, handle, indent=2, sort_keys=True)
        os.replace(tmp, path)
        print(f"results -> {path}", flush=True)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Mission F bank-lab adversarial matrix")
    parser.add_argument("--profile", required=True, choices=["hsbc", "jpmorgan", "lgt", "swift"])
    parser.add_argument("--qcore-url", default="")
    parser.add_argument("--vault-url", default="http://vault:8200")
    parser.add_argument("--org-name", default="")
    args = parser.parse_args(argv)
    qcore_url = args.qcore_url or f"http://qcore-{args.profile}:8080"
    org_name = args.org_name or f"Synthetic {args.profile.capitalize()}-analog Org"
    matrix = Matrix(
        profile=args.profile,
        qcore_url=qcore_url,
        vault_url=args.vault_url,
        org_name=org_name,
    )
    return matrix.run()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
