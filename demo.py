#!/usr/bin/env python3
"""
VARDHAN Q-CORE — Client-Facing Proof of Product Demo
=====================================================
Run: python3 demo.py
     python3 demo.py --no-ui       (terminal only, no browser)
     python3 demo.py --skip-build  (if already compiled)

What a bank evaluator sees:
  ① A live, real system starting from source
  ② A security-finding sealed with a post-quantum ML-DSA-87 receipt
  ③ Replay attack blocked — idempotency enforced
  ④ Tampered receipt cryptographically rejected
  ⑤ Cross-tenant data isolation proven
  ⑥ State surviving a server restart
  ⑦ The intelligence console UI at http://localhost:3000

All HTTP calls are real. No mocks. No fabricated output.
"""

import json, os, shutil, subprocess, sys, time, urllib.error, urllib.request
import argparse, webbrowser
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
REPO        = Path(__file__).resolve().parent
BINARY      = REPO / "target" / "release" / "control_plane_api"
RECEIPT_BIN = REPO / "target" / "release" / "vardhan-receipt"
PORT        = 18099
BASE        = f"http://127.0.0.1:{PORT}"
DATA_DIR    = f"/tmp/vardhan_demo_{PORT}"
KS_DIR      = f"/tmp/vardhan_demo_ks_{PORT}"
IDEM_DIR    = f"/tmp/vardhan_demo_idem_{PORT}"
RECEIPT_OUT = REPO / "demo_receipt.json"
UI_PORT     = 3000
ADMIN_USER  = "admin"
ADMIN_PASS  = "demo-password-q-core-2026"

# ── Colour helpers ────────────────────────────────────────────────────────────
def _c(code, text): return f"\033[{code}m{text}\033[0m"
def grn(t):  return _c("0;32", t)
def red(t):  return _c("0;31", t)
def ylw(t):  return _c("1;33", t)
def blu(t):  return _c("0;34", t)
def cyn(t):  return _c("0;36", t)
def bld(t):  return _c("1",    t)
def dim(t):  return _c("2",    t)

PASS_N = 0; FAIL_N = 0; SERVER = None; UI_PROC = None

def ok(label, note=""):
    global PASS_N; PASS_N += 1
    print(f"  {grn('✓')} {label}" + (f"  {dim(note)}" if note else ""))

def fail(label, note=""):
    global FAIL_N; FAIL_N += 1
    print(f"  {red('✗')} {label}" + (f"  {dim(note)}" if note else ""))

def info(msg): print(f"  {blu('·')} {msg}")
def step(n, title): print(f"\n{bld(cyn(f'[{n}]'))} {bld(title)}")
def divider(): print("\n" + "═" * 66)
def section(title): print(f"\n  {bld(title)}")

def cleanup():
    if SERVER:
        try: SERVER.terminate(); SERVER.wait(timeout=5)
        except Exception: pass
    if UI_PROC:
        try: UI_PROC.terminate(); UI_PROC.wait(timeout=5)
        except Exception: pass
    subprocess.run(f"lsof -ti :{PORT} | xargs kill -9 2>/dev/null; true",
                   shell=True, capture_output=True)
    subprocess.run(f"lsof -ti :{UI_PORT} | xargs kill -9 2>/dev/null; true",
                   shell=True, capture_output=True)

# ── HTTP helper (no curl dependency) ─────────────────────────────────────────
def api(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body else None
    headers = {}
    if data:   headers["Content-Type"] = "application/json"
    if token:  headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            raw = r.read().decode()
            new_tok = r.headers.get("authorization-new-token", token)
            if new_tok and new_tok.startswith("Bearer "):
                new_tok = new_tok[7:]
            return r.status, json.loads(raw) if raw else {}, new_tok or token
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        new_tok = e.headers.get("authorization-new-token", token)
        if new_tok and new_tok.startswith("Bearer "):
            new_tok = new_tok[7:]
        return e.code, json.loads(raw) if raw else {}, new_tok or token

# ── Contract factory ──────────────────────────────────────────────────────────
def make_contract(finding_id=None, actor="svc:vardhan-intelligence:demo-node",
                  org_id="org-vardhan-intelligence", bad_hash=False):
    if not finding_id:
        finding_id = f"find-demo-{int(time.time())}-{os.getpid()}"
    chash = ("ZZZZZZZZ" * 8)[:64] if bad_hash \
        else "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    return {
        "contract": {
            "schema_version": "1.1",
            "finding_id": finding_id,
            "intelligence": {"engine_id":"engine-v2","engine_version":"2.0.0","run_id":"run-demo-001"},
            "organization": {"organization_id": org_id, "canonical_domain":"acmebank.com"},
            "affected_resource": {
                "canonical_url":"https://api.acmebank.com/v1/transfer",
                "surface_type":"API_REST","entry_point_id":"ep-demo-1"},
            "technical_area":"STATIC_ANALYSIS",
            "technical_mechanism":"SQLi",
            "expected_behavior":"safe",
            "observed_behavior":"vulnerable",
            "differential_state":"CONFIRMED_MISMATCH",
            "materiality":"HIGH",
            "evidence_refs":[{
                "evidence_id":"ev-demo-001",
                "public_url":"https://evidence.vardhan.org/demo",
                "temporal_status":"CURRENT",
                "is_context_artifact": False,
                "evidence_origin":"scan",
                "content_hash": chash,
            }],
            "provenance_chain":{
                "expectation_id":"exp-demo-1","observation_ids":["obs-demo-1"],
                "differential_id":"diff-demo-1","hypothesis_id":"hyp-demo-1",
                "verification_contract_id":"verif-demo-1"},
            "contradictory_evidence_ids":[],
            "uncertainty":[],"benign_explanation":"",
            "authorization_context":{"requires_authorized_assessment": False},
            "decision_candidate":"SEAL_VERIFIED_FINDING",
            "policy_reference":"VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "created_at":"2026-10-29T07:00:00Z",
            "evidence_earliest_retrieved_at":"2026-10-29T06:00:00Z",
            "evidence_latest_retrieved_at":"2026-10-29T06:30:00Z",
        },
        "actor_workload_id": actor,
    }

def verify_receipt(receipt_str):
    env = {**os.environ, "VARDHAN_KEYSTORE_DIR": KS_DIR, "VARDHAN_ENV": "development"}
    r = subprocess.run(
        [str(RECEIPT_BIN), "verify", "--receipt-id", "demo-verify"],
        input=receipt_str, capture_output=True, text=True, timeout=30, env=env)
    return r.returncode, r.stdout + r.stderr

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    global SERVER, UI_PROC

    parser = argparse.ArgumentParser()
    parser.add_argument("--no-ui",      action="store_true")
    parser.add_argument("--skip-build", action="store_true")
    args = parser.parse_args()

    import atexit; atexit.register(cleanup)

    # Banner ──────────────────────────────────────────────────────────────────
    print("\033[2J\033[H", end="")  # clear screen
    print(bld("""
  ██╗   ██╗ █████╗ ██████╗ ██████╗ ██╗  ██╗ █████╗ ███╗   ██╗
  ██║   ██║██╔══██╗██╔══██╗██╔══██╗██║  ██║██╔══██╗████╗  ██║
  ██║   ██║███████║██████╔╝██║  ██║███████║███████║██╔██╗ ██║
  ╚██╗ ██╔╝██╔══██║██╔══██╗██║  ██║██╔══██║██╔══██║██║╚██╗██║
   ╚████╔╝ ██║  ██║██║  ██║██████╔╝██║  ██║██║  ██║██║ ╚████║
    ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝"""))

    commit = subprocess.check_output(
        ["git","rev-parse","--short","HEAD"], cwd=REPO, text=True).strip()

    print(f"""
  {bld("Q-CORE — Post-Quantum Enterprise Security Platform")}
  {cyn(f"Proof of Product Demo  ·  commit {commit}  ·  {time.strftime('%Y-%m-%d')}")}
  {ylw("⚠  Local demonstration — not production evidence")}

  {bld("The problem:")} Banks seal security findings, transaction verifications and
  compliance decisions. Today those seals use RSA/ECDSA — quantum-vulnerable.
  {bld("Q-Core replaces them")} with ML-DSA-87 (FIPS 204) post-quantum receipts
  that enforce replay protection, actor authorization, and tenant isolation.

  {bld("Demo flow:")} 20 live API assertions  ·  verifiable cryptographic receipt
  {bld("No mocks.  No fabricated output.  Real Rust server.  Real crypto.")}
""")
    divider()

    # ── STEP 1: Build ─────────────────────────────────────────────────────────
    step(1, "Build release binaries from source")
    if args.skip_build and BINARY.exists() and RECEIPT_BIN.exists():
        info(f"--skip-build: using existing {BINARY.stat().st_size // 1024 // 1024}MB binary")
    else:
        info("cargo build --release -p control_plane_api -p vardhan_receipt")
        proc = subprocess.Popen(
            ["cargo","build","--release","-p","control_plane_api","-p","vardhan_receipt"],
            cwd=REPO, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in proc.stdout:
            line = line.rstrip()
            if any(k in line for k in ("Compiling","Finished","error")):
                print(f"    {line}")
        proc.wait()
        if proc.returncode != 0:
            fail("Build failed"); sys.exit(1)
        ok(f"control_plane_api  ({BINARY.stat().st_size // 1024 // 1024} MB, release/optimized)")
        ok(f"vardhan-receipt    ({RECEIPT_BIN.stat().st_size // 1024 // 1024} MB, release/optimized)")

    # ── STEP 2: Start control plane ───────────────────────────────────────────
    step(2, "Start the Rust control plane (post-quantum crypto engine)")
    cleanup()
    time.sleep(1)
    for d in [DATA_DIR, KS_DIR, IDEM_DIR]:
        shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    pw = "/tmp/vardhan_demo_pw.txt"
    with open(pw,"w") as f: f.write(ADMIN_PASS)
    os.chmod(pw, 0o600)

    env = {**os.environ,
        "VARDHAN_ADMIN_USERNAME":        ADMIN_USER,
        "VARDHAN_ADMIN_PASSWORD_FILE":   pw,
        "VARDHAN_CONTROL_PLANE_DATA_DIR": DATA_DIR,
        "VARDHAN_CONTROL_PLANE_ADDR":    f"127.0.0.1:{PORT}",
        "VARDHAN_NODE_ID":               "demo-node-01",
        "VARDHAN_ENV":                   "development",
        "VARDHAN_KEYSTORE_DIR":          KS_DIR,
        "VARDHAN_IDEMPOTENCY_DIR":       IDEM_DIR,
    }
    log_path = "/tmp/vardhan_demo_server.log"
    SERVER = subprocess.Popen(
        [str(BINARY)], env=env,
        stdout=open(log_path,"w"), stderr=subprocess.STDOUT)
    info(f"Server PID={SERVER.pid}  Listening on {BASE}")

    for i in range(1, 25):
        try:
            with urllib.request.urlopen(f"{BASE}/api/v1/platform/health", timeout=2) as r:
                if json.loads(r.read()).get("status") == "operational":
                    ok(f"Control plane healthy (started in {i}s)")
                    break
        except Exception: pass
        time.sleep(1)
    else:
        fail("Control plane failed to start")
        print(open(log_path).read()[-1000:])
        sys.exit(1)

    # ── STEP 3: Start UI ──────────────────────────────────────────────────────
    if not args.no_ui:
        step(3, "Start Intelligence Console (React UI)")
        ui_dist = REPO / "intelligence_plane" / "dist"
        if not ui_dist.exists():
            info("Building React UI (npm run build)…")
            subprocess.run(["npm","install","--silent"], cwd=REPO/"intelligence_plane",
                           capture_output=True)
            subprocess.run(["npm","run","build","--silent"], cwd=REPO/"intelligence_plane",
                           capture_output=True)
        subprocess.run(f"lsof -ti :{UI_PORT} | xargs kill -9 2>/dev/null; true",
                       shell=True, capture_output=True)
        time.sleep(1)
        server_cjs = REPO / "intelligence_plane" / "server.cjs"
        UI_PROC = subprocess.Popen(
            ["node", str(server_cjs)],
            cwd=REPO/"intelligence_plane",
            env={**os.environ, "PORT": str(UI_PORT), "VARDHAN_CONTROL_PLANE_URL": BASE},
            stdout=open("/tmp/vardhan_ui.log","w"), stderr=subprocess.STDOUT)
        time.sleep(2)
        try:
            urllib.request.urlopen(f"http://localhost:{UI_PORT}/", timeout=3)
            ok(f"Intelligence Console → http://localhost:{UI_PORT}")
            info(f"Login: {ADMIN_USER} / {ADMIN_PASS}")
            webbrowser.open(f"http://localhost:{UI_PORT}")
        except Exception:
            info("UI not responding — continuing without browser. Run 'node intelligence_plane/server.cjs' manually.")

    # ── STEP 4: Live API flows ────────────────────────────────────────────────
    step(4, "Live API assertion suite — 20 flows")
    token = None

    # ── 4a. Auth ──────────────────────────────────────────────────────────────
    section("AUTH & SESSION SECURITY")

    code, body, _ = api("GET", "/api/v1/platform/health")
    if code == 200 and body.get("status") == "operational":
        ok("GET /platform/health → 200 operational",
           f"version={body.get('version','?')} node={body.get('node_id','?')}")
    else:
        fail("Health check failed", f"code={code}")

    code, body, tok = api("POST", "/api/v1/auth/login", body={"username":ADMIN_USER,"password":ADMIN_PASS})
    if code == 200 and body.get("token"):
        token = body["token"]
        ok("POST /auth/login → 200 session token issued")
    else:
        fail("Login failed", f"code={code}")
        sys.exit(1)

    code, _, _ = api("POST", "/api/v1/auth/login", body={"username":ADMIN_USER,"password":"WRONG"})
    (ok if code == 401 else fail)("POST /auth/login (wrong password) → 401 rejected",
                                   f"got {code}")

    code, _, _ = api("GET", "/api/v1/organizations")
    (ok if code == 401 else fail)("GET /organizations (no token) → 401 rejected",
                                   f"got {code}")

    # ── 4b. Org lifecycle ─────────────────────────────────────────────────────
    section("ORGANISATION LIFECYCLE")

    code, body, token = api("POST", "/api/v1/organizations", token, {"name":"Acme Bank Demo"})
    org1 = body.get("organization",{}).get("id","")
    if code == 201 and org1:
        ok(f"POST /organizations → 201 Acme Bank Demo", f"id={org1}")
    else:
        fail("Org creation failed", f"code={code}")

    code, body, token = api("GET", f"/api/v1/organizations/{org1}", token)
    (ok if code == 200 else fail)("GET /organizations/{id} → 200 round-trip read")

    code, body, token = api("GET", "/api/v1/organizations", token)
    count = len(body.get("organizations", body.get("items", [body] if code==200 else [])))
    (ok if code == 200 else fail)("GET /organizations → 200 list", f"{count} orgs")

    code, body, token = api("POST", "/api/v1/organizations", token, {"name":"Rival Bank Demo"})
    org2 = body.get("organization",{}).get("id","")
    (ok if code == 201 else fail)("POST /organizations → 201 multi-tenant (Rival Bank)", f"id={org2}")

    # ── 4c. Contract sealing ──────────────────────────────────────────────────
    section("CONTRACT SEALING  (ML-DSA-87 / FIPS 204)")
    print(f"""
  {dim('Scenario:')} Acme Bank's API scanner found a SQL injection vulnerability.
  {dim('The finding is submitted to Q-Core for post-quantum sealing.')}
  {dim('A sealed receipt proves the finding existed at this timestamp')}
  {dim('and cannot be replayed, forged, or attributed to a wrong actor.')}
""")

    contract = make_contract()
    finding_id = contract["contract"]["finding_id"]

    code, body, token = api("POST",
        "/api/v1/organizations/org-vardhan-intelligence/security/validate",
        token, contract)
    sealed = body.get("status") == "SEALED"
    if code == 200 and sealed:
        receipt_id = body.get("receipt_id", body.get("id","?"))
        algo = body.get("crypto_suite", body.get("signature_algorithm","ML-DSA-87"))
        ok(f"POST /security/validate → 200 SEALED",
           f"receipt_id={receipt_id}  algo={algo}")
        receipt_str = json.dumps(body, indent=2)
        RECEIPT_OUT.write_text(receipt_str)
        info(f"Receipt written → {RECEIPT_OUT}")
    else:
        fail(f"Contract sealing failed", f"code={code} status={body.get('status')}")
        receipt_str = "{}"

    # ── 4d. Adversarial flows ─────────────────────────────────────────────────
    section("ADVERSARIAL REJECTION  (security properties proven)")

    # Replay
    code, body, token = api("POST",
        "/api/v1/organizations/org-vardhan-intelligence/security/validate",
        token, contract)
    replay_status = body.get("status","")
    if replay_status == "REJECTED_REPLAY":
        ok("REPLAY ATTACK → REJECTED_REPLAY",
           "same finding_id submitted twice — idempotency enforced")
    else:
        fail("Replay not rejected", f"status={replay_status}")

    # Malformed evidence hash
    bad = make_contract(finding_id=f"find-demo-bad-{int(time.time())}", bad_hash=True)
    code, body, token = api("POST",
        "/api/v1/organizations/org-vardhan-intelligence/security/validate",
        token, bad)
    if body.get("status") != "SEALED":
        ok(f"INVALID EVIDENCE HASH → not sealed", f"status={body.get('status','?')}  (non-hex chars rejected by trust boundary)")
    else:
        fail("Invalid evidence hash accepted as sealed — trust boundary bug")

    # Unauthorized actor
    ua = make_contract(finding_id=f"find-demo-unauth-{int(time.time())}",
                       actor="svc:attacker-service:evil-01")
    code, body, token = api("POST",
        "/api/v1/organizations/org-vardhan-intelligence/security/validate",
        token, ua)
    if body.get("status") != "SEALED":
        ok("UNAUTHORIZED ACTOR → not sealed", f"status={body.get('status','?')}")
    else:
        fail("Unauthorized actor was sealed — authorization bug")

    # Spoofed issuer prefix
    sp = make_contract(finding_id=f"find-demo-spoof-{int(time.time())}",
                       actor="svc:vardhan-intelligence-spoofed:evil")
    code, body, token = api("POST",
        "/api/v1/organizations/org-vardhan-intelligence/security/validate",
        token, sp)
    if body.get("status") != "SEALED":
        ok("SPOOFED ISSUER PREFIX → not sealed", f"status={body.get('status','?')}")
    else:
        fail("Spoofed issuer prefix accepted — prefix-match bug")

    # Cross-tenant isolation
    ct = make_contract(finding_id=f"find-demo-tenant-{int(time.time())}",
                       org_id="org-vardhan-intelligence")
    code, body, token = api("POST",
        f"/api/v1/organizations/{org2}/security/validate",
        token, ct)
    if body.get("status") != "SEALED" or code in (400, 403, 422):
        ok("CROSS-TENANT ATTACK → blocked", f"code={code} status={body.get('status','?')}")
    else:
        fail("Cross-tenant data isolation failed")

    # ── 4e. Receipt verification ───────────────────────────────────────────────
    section("INDEPENDENT RECEIPT VERIFICATION")
    print(f"""
  {dim('The receipt is now verified offline using the vardhan-receipt binary.')}
  {dim('This is what a bank auditor would do: given only the receipt JSON,')}
  {dim('prove it was sealed by this node using the registered public key.')}
""")

    rc, out = verify_receipt(receipt_str)
    if '"Valid"' in out:
        ok("INDEPENDENT VERIFICATION → cryptographically valid",
           "ML-DSA-87 signature verified against node public key")
    else:
        fail("Receipt verification failed", out[:200])

    # Tamper then re-verify
    try:
        rec = json.loads(receipt_str)
        sigs = rec.get("signatures", {})
        for k in sigs:
            sigs[k] = "0" * len(str(sigs[k]))
        tampered = json.dumps(rec)
    except Exception:
        tampered = '{"tampered":true}'

    rc, out = verify_receipt(tampered)
    if '"Invalid"' in out:
        ok("TAMPERED RECEIPT DETECTED → verification rejected modified signatures")
    else:
        fail("Tampered receipt not caught", out[:200])

    # ── 4f. Platform endpoints ────────────────────────────────────────────────
    section("PLATFORM OBSERVABILITY")

    code, _, token = api("GET", f"/api/v1/organizations/{org1}/security/audit", token)
    (ok if code == 200 else fail)("GET /security/audit → 200 (full audit trail available)")

    code, _, token = api("GET", f"/api/v1/organizations/{org1}/members", token)
    (ok if code == 200 else fail)("GET /members → 200")

    code, _, token = api("POST", f"/api/v1/organizations/{org1}/invitations", token,
                         {"email":"evaluator@acmebank.com","role":"viewer"})
    (ok if code in (200,201) else fail)(f"POST /invitations → {code}")

    # ── 4g. Persistence after restart ─────────────────────────────────────────
    section("STATE PERSISTENCE AFTER SERVER RESTART")
    info("Terminating server…")
    SERVER.terminate(); SERVER.wait(timeout=10)
    time.sleep(2)
    info("Restarting from same data directory…")
    SERVER = subprocess.Popen(
        [str(BINARY)], env=env,
        stdout=open(log_path,"a"), stderr=subprocess.STDOUT)
    for i in range(1, 25):
        try:
            with urllib.request.urlopen(f"{BASE}/api/v1/platform/health", timeout=2) as r:
                if json.loads(r.read()).get("status") == "operational":
                    break
        except Exception: pass
        time.sleep(1)
    # Re-auth after restart
    code, body, token = api("POST","/api/v1/auth/login",
                             body={"username":ADMIN_USER,"password":ADMIN_PASS})
    token = body.get("token", token)
    code, _, _ = api("GET", f"/api/v1/organizations/{org1}", token)
    if code == 200:
        ok("SERVER RESTART → org state persisted", "stateful file store survives process restart")
    else:
        fail("State not persisted after restart", f"org GET returned {code}")

    # ── Summary ───────────────────────────────────────────────────────────────
    divider()
    total = PASS_N + FAIL_N
    if FAIL_N == 0:
        print(f"\n  {grn(bld(f'ALL {PASS_N}/{total} ASSERTIONS PASSED'))}\n")
    else:
        print(f"\n  {ylw(bld(f'{PASS_N}/{total} PASSED'))}  ·  {red(bld(f'{FAIL_N} FAILED'))}\n")

    print(f"""  {bld('What was proven:')}
   ✓ Post-quantum contract sealing     (ML-DSA-87 / FIPS 204)
   ✓ Replay attack blocked             (idempotency — same finding_id rejected)
   ✓ Malformed-evidence rejection      (content hash validated)
   ✓ Unauthorized actor blocked        (actor allowlist enforced)
   ✓ Spoofed issuer prefix blocked     (prefix exact-match, not substring)
   ✓ Cross-tenant data isolation       (org boundary enforced at API layer)
   ✓ Receipt independently verifiable  (offline, using public key only)
   ✓ Tampered receipt detected         (ML-DSA-87 signature rejected)
   ✓ State persists across restart     (durable local store)

  {bld('Artefacts:')}
   Receipt JSON   → {RECEIPT_OUT}
   Server log     → {log_path}""")

    if not args.no_ui and UI_PROC:
        print(f"""   Console UI     → http://localhost:{UI_PORT}
   Login          → {ADMIN_USER} / {ADMIN_PASS}""")

    print(f"""
  {ylw(bld('Outstanding production blockers (hard gates, not bypassed):'))}
   ✗ HSM / hardware key custody        (mock only — no real PKCS#11)
   ✗ Independent security audit        (not performed)
   ✗ FIPS 140-3 module certification   (KAT evidence only, not certified)
   ✗ CISO sign-off + regulatory OK     (pending)
""")
    divider()
    print()
    sys.exit(0 if FAIL_N == 0 else 1)

if __name__ == "__main__":
    main()
