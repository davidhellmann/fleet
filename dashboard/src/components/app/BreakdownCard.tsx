import { CardLabel } from './CardLabel';
import { EmptyState } from './EmptyState';
import { formatShare, formatTokens, formatUsd } from '@/lib/format.ts';
import type { Share } from '@/lib/usage.ts';

export interface BreakdownCardProps {
  title: string;
  shares: Share[];
  /** Rows shown; the rest is summed into one line. */
  limit?: number;
  /** Link per label, e.g. to a project page. */
  hrefOf?: (label: string) => string | undefined;
  className?: string;
}

/**
 * Cost per value of one dimension as a ranked list with share bars: text first, the bar only
 * repeats the share, so nothing rests on the bar alone. Each row stacks: name and cost, the bar,
 * tokens and share, so a third-width card has room for long names (they wrap, never truncate).
 */
export function BreakdownCard({ title, shares, limit = 8, hrefOf, className }: BreakdownCardProps) {
  const shown = shares.slice(0, limit);
  const rest = shares.slice(limit);
  const restCost = rest.reduce((a, s) => a + s.cost, 0);
  const restShare = rest.reduce((a, s) => a + s.share, 0);
  return (
    <section data-slot="breakdown" className={`flex flex-col gap-4 rounded-lg bg-card p-5 ${className ?? ''}`}>
      <CardLabel as="h2">{title}</CardLabel>
      {shares.length === 0 ? (
        <EmptyState>No usage in this period.</EmptyState>
      ) : (
        <ol className="flex flex-col gap-4">
          {shown.map((s) => {
            const href = hrefOf?.(s.label);
            return (
              <li key={s.label} className="flex flex-col gap-1.5">
                <div className="flex items-baseline gap-3 text-sm">
                  <span className="min-w-0 flex-1 font-mono text-xs [overflow-wrap:anywhere]">
                    {href ? <a className="hover:underline" href={href}>{s.label}</a> : s.label}
                  </span>
                  <span className="font-medium">{formatUsd(s.cost)}</span>
                </div>
                <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(s.share * 100, s.cost > 0 ? 0.5 : 0)}%` }} />
                </div>
                <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                  <span>{formatTokens(s.tokens)} tokens</span>
                  <span>{formatShare(s.share)}</span>
                </div>
              </li>
            );
          })}
          {rest.length > 0 && (
            <li className="flex items-baseline gap-3 text-xs text-muted-foreground">
              <span className="flex-1">{rest.length} more</span>
              <span>{formatUsd(restCost)} · {formatShare(restShare)}</span>
            </li>
          )}
        </ol>
      )}
    </section>
  );
}
