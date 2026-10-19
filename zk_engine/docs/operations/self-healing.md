# Self-Healing Policy

> **Author**: Vishnu Vardhan Burri  
> **Status**: Implemented (v0.2.0+)

## Overview

The `zk-proof-engine` API implements a structured self-healing policy. Every operation that can fail is categorized, and the system's recovery behavior is determined by that category — not by ad-hoc error handling.

## Fail-Closed vs. Auto-Recoverable

### ❌ FAIL-CLOSED: Never Auto-Retried

The following conditions **require human intervention**. The system will never automatically retry them:

| Category | Examples | Action |
|---|---|---|
| `SECURITY_ERROR` | Unauthorized config change, gatekeeper denied | Manual review required |
| `CRYPTOGRAPHIC_ERROR` | VK hash mismatch, circuit proof rejection, witness failure | Manual review required |
| `SECURITY_BLOCKED` | Security gate explicitly blocked the operation | Operator investigation required |

These are the absolute non-negotiables. **No retry, no recovery, no bypass.**

### ✅ AUTO-RECOVERABLE: Bounded Retry

| Category | Examples | Behavior |
|---|---|---|
| `TRANSIENT` | Network timeout, RPC blink, temp unavailable | Retry with backoff |
| `RETRYABLE` | Cache miss, ephemeral infra blip | Retry with backoff |

Recovery is **always bounded**. After `maxAttempts`, the status becomes `PERMANENT_FAILURE`.

### 🚫 PERMANENT (No Retry)

| Category | Examples | Behavior |
|---|---|---|
| `VALIDATION_ERROR` | Bad inputs, schema violation | Fail immediately, preserve category |
| `RESOURCE_ERROR` | Quota exceeded | Fail immediately |
| `DEPENDENCY_ERROR` | Missing circuit artifact, missing verifier | Fail immediately |
| `CONFIGURATION_ERROR` | Missing env var, wrong key format | Fail immediately |
| `PERMANENT_FAILURE` | Exhausted retries | Terminal |

## Retry Policy

```typescript
// Default retry configuration:
{
  baseDelayMs: 250,       // first retry: ~250ms
  maxDelayMs: 15_000,     // cap at 15s
  jitterFactor: 0.25,     // ±25% jitter (prevents thundering herd)
  maxAttempts: 5,         // max 5 retries before PERMANENT_FAILURE
}
```

**Backoff formula**: `min(base × 2^attempt, maxDelay) × (1 + jitter × random())`

## Usage

```typescript
import { withSelfHealing, categorizedError } from '@zkpe/api/application/selfHealing.js';

const result = await withSelfHealing(
  async () => {
    try {
      return await rpcClient.call('eth_getBlockNumber');
    } catch (err) {
      // Tag with category for policy routing
      throw categorizedError('TRANSIENT', 'RPC timeout', err);
    }
  },
  DEFAULT_SELF_HEALING_CONFIG,
  metrics,
  'registry.getBlock',
);

if (result.recovered) {
  console.log('Success after', result.attempts, 'attempts');
} else if (result.category === 'SECURITY_ERROR') {
  // Alert on-call — never auto-resolved
  alertOncall(result.error.message);
} else {
  // Log permanent failure
  logger.error({ category: result.category, error: result.error.message }, 'operation failed');
}
```

## Metrics

The self-healing policy emits the following metrics via `MetricsSinkPort`:

| Metric | Labels | Description |
|---|---|---|
| `self_healing_recoveries_total` | `operation` | Successful recovery (attempt > 1) |
| `self_healing_retries_total` | `operation`, `category`, `attempt` | Each retry attempt |
| `self_healing_blocked_total` | `operation`, `category` | Fail-closed (security) blocks |
| `self_healing_permanent_failures_total` | `operation`, `category` | Non-retryable failures |
| `self_healing_exhausted_total` | `operation`, `category` | Exhausted max attempts |

## Job Queue Integration

The job queue (Phase 3) integrates the same error categories:

- `TRANSIENT`/`RETRYABLE` → job re-queued with backoff
- `SECURITY_*` / `CRYPTOGRAPHIC_ERROR` → job enters terminal `FAILED` state; `finishedAt` set
- Other permanent categories → `PERMANENT_FAILURE` error category; `finishedAt` set

**A job in terminal FAILED state with a fail-closed category is never automatically re-queued.** It requires an authorized operator to explicitly re-submit.

## What Is Never Changed by Self-Healing

The following are **architectural constants** — self-healing never touches them:

- ZK circuit mathematics and semantics
- Groth16 verification key (vk) configuration
- Trusted setup parameters
- Gatekeeper rules
- Contract configuration
- Security workflow configuration (Scorecard, CodeQL, etc.)
- Release signing configuration
