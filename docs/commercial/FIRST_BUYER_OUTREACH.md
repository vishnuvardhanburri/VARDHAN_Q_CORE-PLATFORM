# First Buyer Outreach — Verified Contact Outreach Sequences

> Status key:
> - SEND GATE — BLOCKED: contact identity or email address not yet confirmed from a primary source.
> - SEND GATE — CLEARED: contact confirmed; ready to send after final pre-flight check.

---

## 1. Why Generic Banking Outreach Fails

Senior banking executives receive dozens of unsolicited vendor emails weekly. Generic cold outreach fails because:

1. **Vague introductions:** Starting with "I am reaching out from Vardhan Technologies..." immediately flags the message as automated vendor spam.
2. **Abstract feature language:** Claiming a "trust layer that validates evidence provenance and policy enforcement" sounds like marketing jargon without technical substance.
3. **Premature meeting requests:** Asking an executive for a 15-minute chat before establishing concrete value creates high friction with zero return.
4. **Zero demonstrable proof:** No architecture snippets, no benchmark numbers, no reference to their active regulatory liabilities.

---

## 2. The Value-Proof Outreach Architecture

To convert senior banking stakeholders, outreach must follow a strict five-part value architecture:

```
+-------------------------------------------------------------------------------------------+
|                              VALUE-PROOF EMAIL FRAMEWORK                                  |
|                                                                                           |
|  1. Verified research hook: Reference a specific, confirmed public paper or initiative.   |
|  2. Distinct technical problem: Name the exact gap downstream of the research.            |
|  3. Concrete mechanism: Explain the exact cryptographic envelope Q-Core provides.         |
|  4. Running proof: The offer is a live 10-minute demonstration, not slides or a brief.    |
|  5. Zero-friction ask: Ask for 10 minutes only. No sales pitch. No commitment required.   |
+-------------------------------------------------------------------------------------------+
```

---

## 3. Account-Specific Email Sequences

---

### ACCOUNT 1 — HSBC

#### Verified Research Hook
HSBC-05: Will Collison (Technical Director, HSBC Cybersecurity) co-authored the HSBC-Quantinuum
post-quantum gold-token paper (September 2024). The paper establishes HSBC's investment in
post-quantum security at the transport layer.

#### Verified Contact
- **Name:** Will Collison
- **Confirmed title (public source):** Technical Director, HSBC Cybersecurity
- **Source:** HSBC-Quantinuum gold-token paper (September 2024) and corroborated in a secondary
  industry source (PQShield). Title "Interim Global Head of Cryptography" is NOT confirmed from
  a primary HSBC source and must not be used in any external communication.
- **Email address:** NOT confirmed. Do not guess the corporate format.

> **SEND GATE — BLOCKED**
> Action required before sending: verify Will Collison's current email address through a warm
> introduction, a confirmed speaker-bureau listing, or a primary HSBC-controlled directory.
> Confirm his current title is still Technical Director, HSBC Cybersecurity before addressing
> the email.

#### Email — Touch 1 (Day 1)

```
Subject: post-quantum gold tokens and the submission-layer question

Hello Will,

I read the HSBC-Quantinuum paper on future-proofing gold tokens with post-quantum security.

Securing communications is one part of the challenge. Being able to independently verify the
evidence behind a transaction long after it has been processed is another.

Vardhan Q-Core addresses this at the submission layer, validating identity and policy, rejecting
in-scope tampering and replay, and generating cryptographically signed receipts for independent
verification.

I know you receive a lot of emails, so I will not ask you to buy anything or sit through a sales
pitch. Just give me 10 minutes to show you a real transaction, its signed receipt, independent
verification, and what happens when the evidence is altered.

I believe those 10 minutes will be worth your time. If you see the technical value, we can take
it from there. If not, no obligation.

Would you be open to a 10-minute look?

Regards,
Vardhan Technologies
```

#### Demo Script (for the 10-minute meeting)

Steps to run live during the call:
1. Submit a transaction via the Q-Core API; `vardhan-receipt` generates a sealed `VerifiableReceipt` JSON.
2. Show the `actor_identity`, `policy_version`, `evidence_commitments` (SHA-256 hashes), and
   `dual_signature` (Ed25519 + ML-DSA-87) fields.
3. Run `vardhan_verifier` offline (no database access) — receipt passes.
4. Flip one byte in the evidence hash — verifier rejects, fail-closed.
5. Submit the same transaction twice — second submission returns `REJECTED_REPLAY`.

All five steps confirmed passing in `lab_demo_verify.sh` (Lab Run 3, 2026-10-17, macOS).
Traffic enforcement runs as SIMULATED on macOS (eBPF/XDP unavailable). Receipt crypto is REAL.

#### What Must Not Be Said in This Outreach
- Do not use the title "Interim Global Head of Cryptography."
- Do not imply HSBC's post-quantum controls are inadequate.
- Do not promise a production deployment, independent certification, or production SLA.
- Do not fabricate a receipt labelled with HSBC internal system names.

---

### ACCOUNT 2 — JPMorgan Chase

#### Verified Research Hook
JPM-01/03: In February 2022, JPMC, Toshiba, and Ciena announced a metro-scale QKD network
securing a mission-critical blockchain application at up to 800 Gbps. The FLARE (Future Lab for
Applied Research and Engineering) organisation authored this research.

#### Contact Status
- **Lori Beer** — Global Chief Information Officer (confirmed, public JPMC sources).
- **FLARE / Transaction Security Lead** — identity not confirmed. Do not use Dr. Charles Lim's
  name or his title "Global Head of Quantum Communications and Cryptography" — this title is NOT
  confirmed from a primary JPMC source and he may have returned to NUS (National University of
  Singapore).

> **SEND GATE — BLOCKED**
> Action required before sending: identify the current confirmed recipient with a verified role
> in transaction security, cryptographic engineering, or blockchain infrastructure. Check current
> JPMC Technology blog author credits, conference speaker listings (IEEE Quantum Week, Financial
> Cryptography), or the FLARE team page for a current named contact.

#### Email — Touch 1 (Day 1)

```
Subject: 800gbps qkd / the submission-layer question downstream of the optical channel

Hello [Name],

Following JPMC, Toshiba, and Ciena's published research on the 800 Gbps quantum-secured metro
network and blockchain application, our team looked at a separate question worth inspecting:

While QKD and optical encryption protect bytes in transit across the metro link, that protection
terminates at the network interface. What provides independent, verifiable proof of exactly what
was submitted — and by whom — once the instruction enters the processing layer?

Vardhan Q-Core addresses this at the submission boundary: validating identity and policy,
rejecting tampering and replay, and generating cryptographically signed receipts (Ed25519 +
ML-DSA-87) that can be verified offline without database access.

I am not asking you to sit through a sales pitch. Give me 10 minutes to show you a real
transaction, its signed receipt, independent offline verification, and what happens when the
evidence is altered.

Would you be open to a 10-minute look?

Regards,
Vardhan Technologies
```

#### What Must Not Be Said in This Outreach
- Do not name Dr. Charles Lim or use any unverified title.
- Do not imply JPMC's clearing or settlement controls have a gap.
- Do not represent the QKD demo as JPMC-specific; it is a generic lab demonstration.
- Do not claim production throughput or production SLA.

---

### ACCOUNT 3 — LGT Private Banking

#### Verified Research Hook
LGT has a direct cryptocurrency offering and cross-border booking centres in Liechtenstein,
Switzerland, and Singapore. LGT works with regulated custody specialists (AMINA, SEBA) under
FINMA and FMA oversight. Custody authorization for high-net-worth digital asset portfolios
requires auditable instruction lineage between relationship managers and external custodians.

#### Contact Status
- **Senior Executive Board / Chief Operating Officer** — persona confirmed as relevant role;
  individual identity and email not confirmed.
- **Group CISO** — identity not confirmed.
- **Head of Digital Assets or Custody Operations** — identity not confirmed.

> **SEND GATE — BLOCKED**
> Action required before sending: confirm a named individual in a digital assets, custody
> operations, or technology risk role at LGT via their corporate website, conference speaker
> listings, or a warm introduction. Do not guess email formats.

#### Email — Touch 1 (Day 1)

```
Subject: lgt digital asset custody / independent authorization receipts across custodian rails

Dear [Name],

With LGT's direct cryptocurrency offering and cross-border custody operations across
Liechtenstein, Switzerland, and Singapore, there is a structural question that traditional
audit logs do not fully answer:

When a relationship manager authorizes a high-value asset reallocation that transmits to an
external custodian, can the authorization be independently verified — without exposing
confidential client portfolio details — if FINMA or the FMA requires evidence of instruction
lineage?

Vardhan Q-Core generates cryptographically signed receipts at the authorization boundary,
binding the relationship manager's instruction to the custody rail entry using dual post-quantum
signatures (ML-DSA-87 + Ed25519). The receipt can be verified offline by a regulator or auditor
without access to client balances or internal systems.

I am not asking for a sales meeting. Give me 10 minutes to show you a real instruction cycle,
its signed receipt, offline verification, and what happens when the evidence is altered.

Would you be open to a 10-minute look?

Regards,
Vardhan Technologies
```

#### What Must Not Be Said in This Outreach
- Do not name specific LGT client assets, balances, or internal systems.
- Do not claim FINMA or FMA compliance; that requires external regulatory assessment.
- Do not imply LGT's current custody controls are inadequate.

---

### ACCOUNT 4 — Barclays

#### Verified Research Hook
Dr. Lee Braine (CTO Office, Barclays) has published publicly available research on distributed
financial market infrastructure and securities settlement. Barclays participated in IBM Quantum
research on securities settlement batch netting. These are verified from public academic and
industry conference sources.

#### Contact Status
- **Dr. Lee Braine** — CTO Office, Barclays (confirmed from public research publications).
  Email address NOT confirmed. Do not guess the corporate format.
- **Becky Pinkard** — Global Cyber Operations, Barclays (confirmed from public sources).
  Email address NOT confirmed.

> **SEND GATE — BLOCKED**
> Action required before sending: confirm email address for Dr. Lee Braine or Becky Pinkard
> through a warm introduction, verified conference speaker directory, or a primary
> Barclays-controlled source.

#### Email — Touch 1 (Day 1)

```
Subject: securities settlement batch netting and submission-layer evidence

Dear Dr. Braine,

Your published work on distributed financial market infrastructure highlights the need for
verifiable evidence across settlement boundaries, not just transport-layer protection.

Vardhan Q-Core addresses this at the submission layer: each instruction entering the settlement
batch generates a cryptographically signed receipt (ML-DSA-87 + Ed25519) binding the
instruction to the submitting entity, the policy version in force, and a hash of the
instruction payload. The receipt can be verified offline by an auditor without database access.

I am not asking for a sales meeting. Give me 10 minutes to show you a real transaction,
its signed receipt, independent offline verification, and what happens when the evidence is
altered.

Would you be open to a 10-minute look?

Regards,
Vardhan Technologies
```

#### What Must Not Be Said in This Outreach
- Do not fabricate Barclays settlement volumes or internal system names.
- Do not imply Barclays' current settlement controls have a gap.
- Do not promise UK FCA compliance or MiFID II certification.

---

### ACCOUNT 5 — Standard Chartered

#### Verified Research Hook
Standard Chartered participated in Capgemini ML-DSA post-quantum cryptography API pilots and is
a participant in Partior, the DLT-based cross-border ISO 20022 payments network. Both are
confirmed from public sources.

#### Contact Status
- Technology risk, correspondent banking, or payments infrastructure lead — identity not
  confirmed. Do not guess.

> **SEND GATE — BLOCKED**
> Action required before sending: identify a confirmed named contact in Standard Chartered's
> technology risk, transaction banking, or correspondent payments infrastructure team via their
> corporate website, conference speaker listings, or a warm introduction.

#### Email — Touch 1 (Day 1)

```
Subject: partior iso 20022 / submission-layer receipt evidence on the correspondent rail

Dear [Name],

With Standard Chartered's participation in Partior and its PQC API evaluation work, there is a
question worth inspecting at the submission boundary:

When an ISO 20022 payment instruction transmits across the Partior correspondent rail, what
provides independent, verifiable proof of exactly what was submitted — and by whom — if an
instruction is disputed or requires regulatory evidence post-settlement?

Vardhan Q-Core generates cryptographically signed receipts at submission, binding the
instruction to the submitting entity's verified identity and the policy version in force using
dual post-quantum signatures (ML-DSA-87 + Ed25519). A recipient or regulator can verify the
receipt offline without internal system access.

I am not asking for a sales meeting. Give me 10 minutes to show you a real instruction cycle,
its signed receipt, independent offline verification, and what happens when the evidence is
altered.

Would you be open to a 10-minute look?

Regards,
Vardhan Technologies
```

#### What Must Not Be Said in This Outreach
- Do not fabricate Standard Chartered transaction volumes, internal system names, or
  correspondent settlement incidents.
- Do not claim SWIFT compliance, ISO 20022 certification, or regulatory approval.
- Do not imply Standard Chartered's current Partior integration has a control gap.

---

## 4. Pre-Send Flight Check (all accounts)

Before sending any email, confirm all five items:

| Check | Required |
|---|---|
| Recipient name and current title confirmed from a primary source | YES |
| Corporate email address confirmed (warm intro or primary directory) | YES |
| lab_demo_verify.sh passes all five real checks in the demo environment | YES |
| Email contains no unverified title, fabricated internal detail, or compliance claim | YES |
| Zero emojis in the email body | YES |

---

## 5. Discovery Engagement Conversion (after a positive reply)

When a contact replies with interest or requests more detail, execute this three-step procedure:

1. **Send the Technical Note:** Deliver the JSON receipt schema, the offline verifier logic, and
   the synthetic lab benchmark results. Do not present these as production results or certified
   performance metrics.
2. **Frame the Discovery engagement:**
   "We found that teams evaluating this typically have three questions: (1) how to bind receipts
   to existing HSMs via PKCS#11, (2) sub-millisecond performance impact on existing pipelines,
   and (3) offline verification during regulatory audits. We have a bounded 48-hour Discovery
   framework (fixed fee: GBP 15,000) designed to benchmark these questions against your
   synthetic test data."
3. **Lock the Discovery kickoff:** Agree on the statement of work and measurable acceptance
   criteria needed to justify the GBP 60,000 Proof of Value engagement.

---

## 6. Platform Status Disclosure

Vardhan Q-Core current verdict: RELEASE CANDIDATE (Single-Node Verified).

Do not represent the platform as:
- Production-ready for multi-node deployments.
- Independently certified or independently assessed.
- Compliant with any named regulation without a third-party audit.

G1 independent external security assessment: OPEN-prepared. Assessment not yet commissioned.
This must be completed before any representation of production-readiness.
