# Vardhan Q-Core: Institutional Live Demo Runbook

**Runbook Reference:** `QCORE-OPS-LIVE-DEMO-2026-10`  
**Target Audience:** Sales Engineers, Technical Founders, and Client Technical Evaluators  
**Prerequisites:** Docker, macOS / Linux terminal with `cloudflared` installed.

---

## 1. Pre-Meeting Setup (5 Minutes Prior)

### Step 1.1: Launch Stack & Tunnel with One Command
Open your terminal in the repository root and run:

```bash
./qcore share
```

This script automatically:
1. Verifies local Docker daemon health.
2. Ensures the 4-service stack (`control-plane`, `intelligence-plane`, `postgres`, `tls-proxy`) is online.
3. Launches an encrypted, public Cloudflare HTTPS tunnel to the local frontend.
4. Prints the public URL (e.g. `https://random-word-name.trycloudflare.com`).

### Step 1.2: Validate Live PQC Hybrid TLS (Optional Proof)
To demonstrate that the live tunnel supports NIST FIPS 203 hybrid key exchange, run:

```bash
python3 scripts/validate_public_pqc_tls.py https://<your-tunnel-url>.trycloudflare.com
```
*Expected Output:* Confirmed TLS 1.3 negotiation using `X25519MLKEM768`.

---

## 2. Live Meeting Walkthrough Script (15–20 Minutes)

### Act 1: The Problem & The Institutional Boundary (3 Minutes)
* **Goal:** Position Q-Core as the serious, compliant post-quantum infrastructure choice.
* **Talking Points:**
  * "Every financial transaction running on Fedwire, CHAPS, or TARGET2 today uses RSA or ECC digital signatures. Adversaries are recording this traffic today under 'Store Now, Decrypt Later' strategies."
  * "Q-Core is built from first principles for banking: NIST FIPS 204 ML-DSA-87 dual-signing, exact integer arithmetic (no floating-point drift), and hardware HSM custody."
* **Screen Display:** Open the GitHub README or Dossier. Highlight the badge:  
  `LOCAL POV VERIFIED | STAGING ACCEPTANCE VERIFIED | PRODUCTION BLOCKED`
  * "Notice we explicitly state **PRODUCTION BLOCKED**. We guarantee to bank risk committees that Q-Core will never connect to live money rails until formal counterparty PKI federation and regulatory non-objection are finalized."

### Act 2: Dual Cryptographic Signatures in Action (5 Minutes)
* **Goal:** Demonstrate genuine post-quantum receipt sealing.
* **Screen Display:** Navigate to the live demo UI (`https://<tunnel-url>.trycloudflare.com`).
* **Steps:**
  1. Click **Findings & Receipts** in the left sidebar.
  2. Select an unsealed security finding and click **Seal Finding Receipt**.
  3. Inspect the resulting receipt:
     * Point out the dual signatures: Classical **Ed25519** (64 bytes) + Post-Quantum **ML-DSA-87** (4,627 bytes).
     * Point out the exact financial minor units (`amount_minor_units`) and BLAKE3 hash chaining.
     * "Even if a future quantum computer breaks Ed25519, the ML-DSA-87 signature remains mathematically immutable."

### Act 3: Cloud Hardware Custody & Process Recovery (4 Minutes)
* **Goal:** Prove keys are protected by real HSM hardware and never persist in plaintext.
* **Talking Points:**
  * "Private keys in Q-Core are never stored unencrypted on disk. We use hardware envelope encryption backed by AWS KMS hardware modules (FIPS 140-2 Level 3) in Europe Stockholm."
  * "When our daemon restarts, it calls AWS KMS Decrypt to unwrap the DEK directly into volatile memory buffers that zeroize on drop. If anyone tampers with even a single byte of the encrypted envelope, the daemon refuses to start."
* **Evidence Reference:** Mention [`docs/AWS_KMS_DAEMON_RECOVERY_REPORT.md`](AWS_KMS_DAEMON_RECOVERY_REPORT.md).

### Act 4: The Commercial Offer — Discovery to PoV (3 Minutes)
* **Goal:** Close the call with a concrete, bounded next step.
* **Screen Display:** Navigate to **Billing & Plan Catalog** in the UI (or `GET /api/v1/catalog/plans`).
* **Talking Points:**
  * "We do not ask institutions to buy production software on day one."
  * "We propose a bounded two-stage evaluation:
     1. **Stage 1: Architecture & Security Discovery (£15,000 fixed fee, 2 weeks):** We assess your specific payment workflow, inventory classical crypto touchpoints, and define clear success criteria.
     2. **Stage 2: Technical Proof of Value (£65,000 fixed fee, 4–6 weeks):** We deploy Q-Core in your private VPC, test with your simulated transaction volume, and deliver a formal Bank Acceptance Dossier."
  * "Would your team be open to scheduling the 2-week Discovery to evaluate your ISO 20022 messaging pipelines?"

---

## 3. Post-Meeting Teardown

When the call concludes:
1. In the terminal running `./qcore share`, press **`Ctrl + C`**. The public Cloudflare tunnel is immediately destroyed.
2. (Optional) To stop all local Docker containers and free memory:
   ```bash
   ./qcore down
   ```
3. Follow up with the prospect by emailing the customer-facing pack:
   * [`docs/DISCOVERY_AND_POV_ENGAGEMENT_PACKAGE.md`](DISCOVERY_AND_POV_ENGAGEMENT_PACKAGE.md)
   * [`docs/TECHNICAL_POV_SECURITY_DOSSIER.md`](TECHNICAL_POV_SECURITY_DOSSIER.md)
