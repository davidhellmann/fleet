import { TableCell } from '@/components/ui/table';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from './EmptyState';
import { formatAgo, formatUsd } from '@/lib/format.ts';
import type { PullCost, PullRequest } from '@/lib/pulls.ts';
import type { RepoGithub } from '../../../collect/github.ts';

const STATE: Record<PullRequest['state'], string> = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' };
const REVIEW: Record<string, string> = { approved: 'Approved', 'changes-requested': 'Changes requested', 'review-required': 'Review required' };

/** "3 passed", "1 failed · 2 passed", "2 pending"; null without checks. */
export function checksLabel(c: PullRequest['checks']): string | null {
  if (!c) return null;
  const parts = [c.failed ? `${c.failed} failed` : '', c.pending ? `${c.pending} pending` : '', c.passed ? `${c.passed} passed` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'no checks';
}

/** Dot colour of checks: failed > pending > passed. */
const checksDot = (c: PullRequest['checks']) => (!c ? 'bg-muted-foreground' : c.failed ? 'bg-negative' : c.pending ? 'bg-warning' : 'bg-positive');

/**
 * One table cell for the projects list: open PRs and the worst check state among them.
 * Text carries the state; the dot repeats it.
 */
export function PullsCell({ data }: { data: RepoGithub | undefined }) {
  if (!data) return <TableCell className="text-xs text-muted-foreground">–</TableCell>;
  if (data.error) return <TableCell className="text-xs text-muted-foreground" title={data.error}>not read</TableCell>;
  const open = data.pulls.filter((p) => p.state === 'open' || p.state === 'draft');
  if (open.length === 0) return <TableCell className="text-xs text-muted-foreground">none open</TableCell>;
  const failed = open.filter((p) => p.checks?.failed).length;
  const pending = open.filter((p) => !p.checks?.failed && p.checks?.pending).length;
  return (
    <TableCell className="text-xs">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className={`size-1.5 rounded-full ${failed ? 'bg-negative' : pending ? 'bg-warning' : 'bg-positive'}`} />
        {open.length} open
      </span>
      <span className="block text-muted-foreground">{failed ? `${failed} failing` : pending ? `${pending} pending` : 'checks pass'}</span>
    </TableCell>
  );
}

/** The project page's pull requests: open first, then the latest ended, each with its cost. */
export function PullRequestTable({ pulls, costs }: { pulls: PullRequest[]; costs: Map<number, PullCost> }) {
  if (pulls.length === 0) return <EmptyState>No pull requests.</EmptyState>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Pull request</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Checks</TableHead>
          <TableHead>When</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pulls.map((p) => {
          const cost = costs.get(p.number);
          return (
            <TableRow key={p.number}>
              <TableCell className="max-w-96 whitespace-normal">
                <a className="hover:underline" href={p.url}><span className="font-mono text-xs text-muted-foreground">#{p.number}</span> {p.title}</a>
                <span className="block font-mono text-xs text-muted-foreground">{p.branch}</span>
              </TableCell>
              <TableCell className="text-xs">
                {STATE[p.state]}
                {p.review && <span className="block text-muted-foreground">{REVIEW[p.review]}</span>}
              </TableCell>
              <TableCell className="text-xs">
                {p.checks ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className={`size-1.5 rounded-full ${checksDot(p.checks)}`} />
                    {checksLabel(p.checks)}
                  </span>
                ) : <span className="text-muted-foreground">–</span>}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {p.endedAt ? `${p.state === 'merged' ? 'merged' : 'closed'} ${formatAgo(p.endedAt)}` : `opened ${formatAgo(p.createdAt)}`}
              </TableCell>
              <TableCell className="text-right">
                {cost && cost.cost > 0 ? <span className="font-medium">{formatUsd(cost.cost)}</span> : <span className="text-muted-foreground">–</span>}
                {cost && cost.days > 0 && <span className="block text-xs text-muted-foreground">{cost.days} day{cost.days === 1 ? '' : 's'}</span>}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
