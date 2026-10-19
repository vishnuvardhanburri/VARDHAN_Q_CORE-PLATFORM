# Bank Signal Provenance — Verification Log

**Document ID:** BANK_SIGNAL_PROVENANCE
**Generated:** 2026-10-13
**Git HEAD:** unknown
**Classification:** INTERNAL — Authorization Required

---

## Purpose

This document records the verification trail for every bank signal in the
`BankSignalDatabase`. Each signal was verified by fetching the public source URL
and extracting the verbatim evidence. No fabricated claims, private vulnerabilities,
undisclosed incidents, deployed algorithms, or internal weaknesses are present.

---

## Verification Methodology

1. **Source retrieval** — Each URL was fetched via `curl` with a browser User-Agent.
2. **Content extraction** — Page text was extracted from HTML; PDF text was
   extracted using `pymupdf`.
3. **Verbatim evidence** — Each `evidenceExcerpt` and `evidenceQuote` is a direct
   quote (or faithful paraphrase) from the extracted source text.
4. **HTTP status** — Each source URL returned HTTP 200 (or PDF was successfully
   downloaded and parsed).
5. **Date extraction** — Publication dates were extracted from:
   - JSON-LD `datePublished` fields in page metadata
   - `Last-Modified` HTTP response headers
   - Filename date patterns (e.g., `250923` → September 23, 2025)
   - Article body date strings
6. **Inference separation** — Each signal has:
   - `observedFact`: what the source explicitly states (public fact)
   - `inferredImplication`: Vardhan's technical inference, prefixed with
     `VARDHAN_INFERENCE`

---

## Source 1: JPMorgan Chase — Applied Research

- **URL:** https://www.jpmorganchase.com/about/technology/research/applied-research
- **HTTP status:** 200
- **Last-Modified:** Tue, 13 Oct 2026 15:52:34 GMT
- **Fetch command:** `curl -sL "https://www.jpmorganchane.com/about/technology/research/applied-research"`
- **Verification date:** 2026-10-13

### Signals derived:

| Signal ID | Observed Fact | Verbatim Evidence |
|-----------|---------------|-------------------|
| JPMC-QSR-001 | JPMorganChase explores Quantum Computing and Quantum-Secured Communications to address quantum disruption to cryptography | "Exploring the frontiers of Quantum Technologies as they are applied to the business, covering Quantum Computing and Quantum-Secured Communications, to address Quantum Computing's inevitable disruption to today's cryptography." |
| JPMC-QSR-002 | Networking and Security R&D Team leads quantum networking and quantum-safe cryptography research | "The Networking and Security R&D Team at Global Technology Applied Research is leading research efforts in quantum networking and quantum-safe cryptography, which aim to address future risks of quantum computing attacks." |
| JPMC-QSR-003 | Blockchain team researching quantum-resistant adaptations | "In preparation for the arrival of cryptographically relevant quantum computers, the team is conducting research into methods to adapt blockchain technologies to be quantum resistant." |

### Additional verification:
- JPMorganChase is "one of the first financial institutions worldwide to invest in quantum computing and to build an internal team of scientists"
- "Industry Advisory Council for the U.S. Department of Energy's Quantum Science Center"
- "Industry Advisory Council for the U.S. Department of Energy's National Quantum Initiative Center"

---

## Source 2: JPMorgan Chase — Cybersecurity Blog

- **URL:** https://www.jpmorganchase.com/about/technology/blog/fortifying-the-enterprise-10-actions-to-take-now-for-ai-ready-cyber-resilience
- **HTTP status:** 200
- **datePublished (JSON-LD):** 2026-04-17
- **Author:** JPMorganChase Global Technology Leadership Team
- **Fetch command:** `curl -sL "https://www.jpmorganchase.com/about/technology/blog/fortifying-the-enterprise-10-actions-to-take-now-for-ai-ready-cyber-resilience"`
- **Verification date:** 2026-10-13

### Signals derived:

| Signal ID | Observed Fact | Verbatim Evidence |
|-----------|---------------|-------------------|
| JPMC-CYB-001 | Recommends contractual security-notification, right-to-audit, and recovery-objective requirements | "Establish contractual requirements for timely security notifications, right-to-audit provisions, and defined recovery objectives, and verify these commitments are being met, not just documented." |
| JPMC-CYB-002 | Recommends mapping security-patch lifecycles end-to-end with auditability | "Map the end-to-end lifecycle of a security patch from vendor release to production deployment; identify every handoff, approval gate, and testing queue that adds latency." |

---

## Source 3: HSBC — Quantum Technology Page

- **URL:** https://www.hsbc.com/who-we-are/hsbc-and-digital/hsbc-and-quantum
- **HTTP status:** 200
- **Last-Modified:** Tue, 13 Oct 2026 18:51:18 GMT (response header)
- **Date on page:** 2026-09-07
- **Fetch command:** `curl -sL "https://www.hsbc.com/who-we-are/hsbc-and-digital/hsbc-and-quantum"`
- **Verification date:** 2026-10-13

### Signals derived:

| Signal ID | Observed Fact | Verbatim Evidence |
|-----------|---------------|-------------------|
| HSBC-QSR-001 | HSBC has Quantum Technologies team, building quantum defences | "We believe quantum technology is going to have a very significant impact on the financial services industry. ... Building quantum defences. Protecting against future cyber threats." |
| HSBC-QSR-002 | HSBC working with Quantinuum on post-quantum cryptography | "We're working with Quantinuum to apply quantum technologies and post-quantum cryptography to financial innovation, including the first application for tokenised physical gold." |

### Additional verification:
- "HSBC Quantum Singapore Centre of Excellence" — partnership with MAS and local banks
- "Group Head of Quantum Technologies, Emerging Technology, Innovation and Ventures, HSBC" (Philip Intallura)
- "Our in-house quantum experts are leading the industry with groundbreaking developments to enhance computational capabilities and cyber resilience"

---

## Source 4: HSBC x IBM — Quantum Algo Trading Transcript (PDF)

- **URL:** https://www.hsbc.com/-/files/hsbc/who-we-are/pdf/250923-hsbc-x-ibm-quantum-algo-trading-transcript.pdf
- **HTTP status:** 200
- **Filename date:** 250923 → 2025-09-23
- **Speakers:** Philip Intallura (Group Head of Quantum Technologies, HSBC), Dr. Jay Gambetta (VP, IBM Quantum), Dr. Manuel Proissl (IBM Quantum Industry Applications Lead, Financial Services), Josh Freeland (Global Head of Algo Credit Trading, HSBC)
- **Fetch command:** `curl -sL "https://www.hsbc.com/-/files/hsbc/who-we-are/pdf/250923-hsbc-x-ibm-quantum-algo-trading-transcript.pdf"`
- **Verification date:** 2026-10-13
- **PDF extraction:** `pymupdf` — 2 pages, text extracted successfully

### Signals derived:

| Signal ID | Observed Fact | Verbatim Evidence |
|-----------|---------------|-------------------|
| HSBC-QSR-003 | Quantum/hybrid workflow demonstrated 34% improvement in trade prediction | "What we've effectively shown here is up to 34 per cent improvement in predicting whether an order will be fulfilled." and "This is the single most important achievement of the HSBC quantum programme to date" |

---

## Source 5: HSBC — Views Article on Quantum Upskilling

- **URL:** https://www.hsbc.com/news-and-views/views/hsbc-views/upskilling-everyone-is-vital-for-the-quantum-era
- **HTTP status:** 200
- **datePublished (from page):** 2025-06-09
- **Author:** William Shoosmith, Quantum Innovation Manager, HSBC
- **Fetch command:** `curl -sL "https://www.hsbc.com/news-and-views/views/hsbc-views/upskilling-everyone-is-vital-for-the-quantum-era"`
- **Verification date:** 2026-10-13

### Signals derived:

| Signal ID | Observed Fact | Verbatim Evidence |
|-----------|---------------|-------------------|
| HSBC-QSR-004 | Nearly 80% of major global banks engaging with quantum technologies | "With nearly 80 per cent of major global banks already engaging with quantum technologies" |
| HSBC-QSR-005 | Quantum computers will break current encryption standards | "Quantum computers will be capable of breaking the encryption standards underpinning our digital world – the time to act is now" |
| HSBC-QSR-006 | Increasing regulatory activity around quantum-safe readiness | "We're seeing increasing activity among major financial regulators around quantum-safe readiness, with signs that it may soon become part of their supervisory frameworks." |

### Additional verification:
- "transitioning to quantum-safe systems is a major operation, requiring careful planning and specific expertise"
- "quantum defence masterclasses for cybersecurity architects"
- "cultivating enterprise-wide quantum literacy is fast becoming a competitive necessity"
- "The number of quantum professionals in banking has grown by 10% since August 2024"

---

## Inference Separation Log

All `inferredImplication` fields contain the prefix `VARDHAN_INFERENCE` to
clearly distinguish them from observed facts. The following inferences were made:

1. **JPMC-QSR-001:** Inference that JPMorganChase's quantum research indicates "active cryptographic agility initiative" — based on the stated research focus, NOT on any disclosed deployment.
2. **JPMC-QSR-002:** Inference that the quantum-safe cryptography research suggests "active assessment of quantum-safe migration paths" — based on the stated research direction, not on any production system.
3. **HSBC-QSR-001:** Inference that HSBC's quantum defence work indicates "active post-quantum migration planning" — based on stated strategic focus, not on any deployed system.
4. **HSBC-QSR-002:** Inference that the Quantinuum collaboration is a "proof-of-concept or pilot" — based on language "first application", not on confirmed production deployment.

No inference claims:
- ✗ Deployed cryptographic algorithms
- ✗ Private vulnerabilities or undisclosed incidents
- ✗ Internal bank weaknesses
- ✗ Specific budgets or procurement timelines
- ✗ Buying intent or purchase decisions

---

## Evidence Gaps Summary

| Institution | Signal ID | Gap |
|-------------|-----------|-----|
| JPMorgan Chase | JPMC-QSR-001 | No specific migration timeline or deadline disclosed publicly |
| JPMorgan Chase | JPMC-QSR-001 | No deployed algorithm stack is specified |
| JPMorgan Chase | JPMC-QSR-002 | No specific quantum-safe protocols or vendors are named |
| JPMorgan Chase | JPMC-QSR-002 | Deployment status (prototype vs. production pilot) not disclosed |
| JPMorgan Chase | JPMC-QSR-003 | Specific blockchain platforms affected are not named |
| JPMorgan Chase | JPMC-QSR-003 | No timeline for quantum-resistant migration is disclosed |
| HSBC | HSBC-QSR-001 | Specific quantum-safe algorithms or protocols in use are not disclosed |
| HSBC | HSBC-QSR-001 | Timeline for quantum-defence deployment is not published |
| HSBC | HSBC-QSR-002 | Specific PQC algorithms being tested are not named |
| HSBC | HSBC-QSR-002 | Production deployment plans are not disclosed |
| HSBC | HSBC-QSR-003 | Performance measured on trading prediction, not security outcomes |
| HSBC | HSBC-QSR-004 | "Nearly 80%" figure is industry-aggregated, not HSBC-specific |
| HSBC | HSBC-QSR-004 | No specific upskilling metrics or timeline are provided |
| HSBC | HSBC-QSR-005 | No specific migration timeline or algorithm preference is disclosed |
| HSBC | HSBC-QSR-006 | No specific regulator or framework is named |
| HSBC | HSBC-QSR-006 | No timeline for supervisory framework changes is provided |
