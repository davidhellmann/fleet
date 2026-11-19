import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CardLabel } from './CardLabel';
import { EmptyState } from './EmptyState';
import { formatAgo, formatTokens, formatUsd } from '@/lib/format.ts';
import type { AmpThreadRow } from '../../../collect/amp.ts';

interface ThreadTotal {
  thread: string;
  title: string;
  tokens: number;
  orbHours: number;
  recordedCost: number;
  days: number;
}

/** Sums the period's rows per thread, most tokens first. */
export function threadTotals(rows: readonly AmpThreadRow[]): ThreadTotal[] {
  const by = new Map<string, ThreadTotal & { daySet: Set<string> }>();
  for (const r of rows) {
    const t = by.get(r.thread) ?? { thread: r.thread, title: r.title, tokens: 0, orbHours: 0, recordedCost: 0, days: 0, daySet: new Set<string>() };
    t.tokens += r.tokens;
    t.orbHours += r.orbHours;
    t.recordedCost += r.recordedCost;
    t.daySet.add(r.day);
    by.set(r.thread, t);
  }
  return [...by.values()].map(({ daySet, ...t }) => ({ ...t, days: daySet.size })).sort((a, b) => b.tokens - a.tokens);
}

/**
 * Amp threads of the period: tokens, included orb hours and what Amp billed. Amp gives no models
 * per thread, so there is no list price here; the usage tables above carry it per model.
 */
export function AmpThreads({ rows, at, error, limit = 15 }: { rows: AmpThreadRow[]; at: string | null; error: string | null; limit?: number }) {
  const totals = threadTotals(rows);
  return (
    <section data-slot="amp-threads" className="flex flex-col gap-4 rounded-lg bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardLabel as="h2">Amp threads</CardLabel>
        {at && <p className="font-mono text-xs text-muted-foreground">{totals.length} threads · as of {formatAgo(at)}{error ? ` · last read stopped: ${error}` : ''}</p>}
      </div>
      {totals.length === 0 ? (
        <EmptyState>{at ? 'No Amp threads in this period.' : 'Amp is not read yet: set "amp": true in fleet.local.json on one host and run pnpm collect.'}</EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Thread</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">Orb hours</TableHead>
              <TableHead className="text-right">Billed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {totals.slice(0, limit).map((t) => (
              <TableRow key={t.thread}>
                <TableCell className="max-w-96 whitespace-normal">
                  <a className="hover:underline" href={`https://ampcode.com/threads/${t.thread}`}>{t.title}</a>
                  <span className="block text-xs text-muted-foreground">{t.days} day{t.days === 1 ? '' : 's'}</span>
                </TableCell>
                <TableCell className="text-right">{formatTokens(t.tokens)}</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">{t.orbHours > 0 ? `${Math.round(t.orbHours * 10) / 10} h` : '–'}</TableCell>
                <TableCell className="text-right font-medium">{formatUsd(t.recordedCost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {totals.length > limit && <p className="text-xs text-muted-foreground">{totals.length - limit} more threads in this period.</p>}
      <p className="text-xs text-muted-foreground">Billed is what Amp recorded; usage over a linked Claude or ChatGPT subscription records $0. The Amp rows in the usage tables are at list prices.</p>
    </section>
  );
}
