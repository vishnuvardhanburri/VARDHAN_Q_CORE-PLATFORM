/**
 * Metrics — aggregate counters/gauges/durations rendered in Prometheus text
 * format (§13). No per-client or per-request detail is exposed publicly.
 */

import type { MetricsSinkPort } from '../../domain/ports.js';

export class Metrics implements MetricsSinkPort {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly durations = new Map<string, { count: number; sumMs: number }>();

  private key(name: string, labels: Record<string, string> = {}): string {
    const labelStr = Object.keys(labels)
      .sort()
      .map((k) => `${k}="${escapeLabel(labels[k]!)}"`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  inc(name: string, count = 1, labels: Record<string, string> = {}): void {
    const k = this.key(name, labels);
    this.counters.set(k, (this.counters.get(k) ?? 0) + count);
  }

  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  duration(name: string, valueMs: number): void {
    const cur = this.durations.get(name) ?? { count: 0, sumMs: 0 };
    cur.count += 1;
    cur.sumMs += valueMs;
    this.durations.set(name, cur);
  }

  render(): string {
    const lines: string[] = ['# zkpe api metrics'];
    for (const [name, d] of this.durations) {
      lines.push(`# TYPE ${name}_seconds summary`);
      lines.push(`${name}_seconds_count ${d.count}`);
      lines.push(`${name}_seconds_sum ${(d.sumMs / 1000).toFixed(6)}`);
    }
    for (const [k, v] of sorted(this.counters)) lines.push(`${k} ${v}`);
    for (const [k, v] of sorted(this.gauges)) lines.push(`${k} ${v}`);
    return lines.join('\n') + '\n';
  }
}

function sorted(map: Map<string, number>): [string, number][] {
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}