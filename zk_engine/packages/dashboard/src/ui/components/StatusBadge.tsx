import type { ReactNode } from 'react';

export type BadgeTone = 'ok' | 'bad' | 'warn' | 'muted';

export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className={`badge ${tone}`} data-testid="status-badge">
      {children}
    </span>
  );
}

export function booleanBadge(value: boolean | undefined | null, truthy: string, falsy: string) {
  return value ? (
    <StatusBadge tone="ok">{truthy}</StatusBadge>
  ) : (
    <StatusBadge tone="bad">{falsy}</StatusBadge>
  );
}