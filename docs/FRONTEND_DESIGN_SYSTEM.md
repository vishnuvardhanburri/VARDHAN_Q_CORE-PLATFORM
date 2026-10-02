# VARDHAN QUANTUM — ENTERPRISE FRONTEND DESIGN SYSTEM (VISION PRO SPEC)

**Design Language**: Spatial Glassmorphism, Quantum Dark, High-Density Information Architecture, Strict Contrast & Cryptographic Precision  
**Audience**: CISOs, Cryptographic Engineers, SOC Operators, Infrastructure Auditors  

---

## 1. Visual Philosophy & Core Principles

- **Zero Gimmicks**: No glowing neon cyberpunk skulls, no fake quantum particle animations, no video game shields. Vardhan Quantum is mission-critical infrastructure software protecting enterprise assets where failure is catastrophic.
- **Spatial Elevation & Translucency**: Deep backgrounds (`#0B0E14` void black) layered with frosted glass panels (`backdrop-filter: blur(20px)`), subtle 1px structural borders (`rgba(255, 255, 255, 0.08)`), and soft drop shadows.
- **Architectural Precision**: Clean geometric grids, high-density data tables, monospaced cryptographic hashes, and definitive state indicators.
- **Data Truth Rule**: Every numerical value and status indicator reflects live backend state. When telemetry is unavailable, components render explicit truthful fallbacks: `DATA NOT AVAILABLE`, `NOT CONFIGURED`, or `AWAITING TELEMETRY`.

---

## 2. Color Palette & Semantics

| Semantic Name | Hex Code | Purpose / Usage |
| :--- | :--- | :--- |
| **Void Black** | `#0B0E14` | Primary global canvas background |
| **Deep Space** | `#121722` | Card base / Secondary surface |
| **Elevated Surface** | `#1A2233` | Modals, dropdowns, and flyout drawers |
| **Glass Border** | `rgba(255, 255, 255, 0.08)` | Structural panel bounding lines |
| **Quantum Cyan** | `#00F5D4` | Primary accent, verified cryptographic state, live pulse |
| **Cipher Violet** | `#8A2BE2` | FIPS 203 ML-KEM encapsulation indicators |
| **Signature Blue** | `#0075FF` | FIPS 204 ML-DSA signing indicators |
| **Success Emerald** | `#01B574` | Quorum reached, Raft Leader elected, healthy node |
| **Warning Amber** | `#FFCC00` | Node degraded, high memory pressure, election timeout |
| **Critical Crimson** | `#F56565` | Replay detected, integrity mismatch, Raft candidate split |
| **Text High Emphasis**| `#FFFFFF` | Primary headers, numeric metrics, cryptographic hashes |
| **Text Medium Emphasis**| `#A0AEC0` | Subtitles, field labels, metadata descriptions |
| **Text Low Emphasis** | `#64748B` | Table column headers, timestamps, disabled items |

---

## 3. Typography Hierarchy

| Level | Family | Weight | Size / Line Height | Color | Tracking |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Display (Hero)** | Inter, sans-serif | 800 | 44px / 52px | `#FFFFFF` | `-0.03em` |
| **Heading 1** | Inter, sans-serif | 700 | 28px / 36px | `#FFFFFF` | `-0.02em` |
| **Heading 2** | Inter, sans-serif | 600 | 20px / 28px | `#FFFFFF` | `-0.01em` |
| **Heading 3 (Card)** | Inter, sans-serif | 600 | 16px / 22px | `#FFFFFF` | `0` |
| **Body (Main)** | Inter, sans-serif | 400 | 14px / 20px | `#A0AEC0` | `0` |
| **Meta / Caption** | Inter, sans-serif | 500 | 11px / 14px | `#64748B` | `0.06em (Uppercase)` |
| **Cryptographic Mono**| JetBrains Mono, monospace | 500 | 13px / 18px | `#00F5D4` | `0` |

---

## 4. Reusable Spatial Components

### 4.1. Glass Card Panel (`.vq-card`)
```css
.vq-card {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.01) 100%);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
  padding: 24px;
}
```

### 4.2. Status Badges & Pill Indicators
- **Verified / Quorum**: Green background `rgba(1, 181, 116, 0.15)`, text `#01B574`, border `1px solid rgba(1, 181, 116, 0.3)`.
- **Degraded / Warning**: Amber background `rgba(255, 204, 0, 0.15)`, text `#FFCC00`, border `1px solid rgba(255, 204, 0, 0.3)`.
- **Fault / Mismatch**: Red background `rgba(245, 101, 101, 0.15)`, text `#F56565`, border `1px solid rgba(245, 101, 101, 0.3)`.
- **Data Not Available**: Slate background `rgba(100, 116, 139, 0.15)`, text `#94A3B8`, border `1px solid rgba(100, 116, 139, 0.25)`.

### 4.3. High-Density Evidence Tables
- Compact row height ($44\text{px}$) for maximum operational visibility.
- Monospaced, truncated hashes with one-click copy tooltips.
- Visual hover highlight with subtle lateral gradient translation.

### 4.4. Persona Presentation Modes
- **Executive**: High-level cluster health, SLA availability, risk posture, and cryptographic assurance scores.
- **Security / IT**: Cryptographic suite configurations, wire entropy levels, identity pools, and key rotation status.
- **SOC / Operator**: Active proxy sessions, real-time SSE event stream, failover controls, and drain state machine.
- **Auditor**: Append-only Merkle ledger verification, signature validity, historical cryptographic chains, and compliance export.
