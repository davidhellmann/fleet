import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from './EmptyState';
import { formatAgo, formatUsd } from '@/lib/format.ts';
import type { CommitRow, GoneBranch, Uncommitted } from '../../../collect/commits.ts';

export interface CommitsProps {
  /** The repo's commits in the period, newest first. */
  commits: CommitRow[];
  uncommitted: Uncommitted[];
  goneBranches: GoneBranch[];
  /** https://github.com/owner/name, to link the hashes; none for other hosts. */
  repoUrl?: string | null;
  limit?: number;
}

/**
 * Estimated cost per commit: each reply on a branch counts towards the next commit there. Then the
 * work no commit took: after the last commit, and on branches git no longer has.
 */
export function Commits({ commits, uncommitted, goneBranches, repoUrl, limit = 25 }: CommitsProps) {
  const shown = commits.slice(0, limit);
  return (
    <div className="flex flex-col gap-4">
      {shown.length === 0 ? (
        <EmptyState>No commits with agent work in this period.</EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Commit</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Landed</TableHead>
              <TableHead className="text-right">Replies</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((c) => (
              <TableRow key={`${c.host}:${c.hash}`}>
                <TableCell className="max-w-96 whitespace-normal">
                  {repoUrl ? (
                    <a className="hover:underline" href={`${repoUrl}/commit/${c.hash}`}><span className="font-mono text-xs text-muted-foreground">{c.hash.slice(0, 7)}</span> {c.subject}</a>
                  ) : (
                    <span><span className="font-mono text-xs text-muted-foreground">{c.hash.slice(0, 7)}</span> {c.subject}</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{c.branch}</TableCell>
                <TableCell className="text-xs text-muted-foreground" title={`work from ${c.firstAt} to ${c.lastAt}`}>{c.day}</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">{c.replies} · {c.sessions} session{c.sessions === 1 ? '' : 's'}</TableCell>
                <TableCell className="text-right font-medium">{c.cost === null ? '–' : formatUsd(c.cost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {commits.length > limit && <p className="text-xs text-muted-foreground">{commits.length - limit} older commits in this period not shown.</p>}

      {(uncommitted.length > 0 || goneBranches.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {uncommitted.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">After the last commit</h3>
              <ul className="flex flex-col gap-1.5 text-xs">
                {uncommitted.map((u) => (
                  <li key={u.branch} className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 font-mono [overflow-wrap:anywhere]">{u.branch}</span>
                    <span className="text-muted-foreground">{u.replies} replies · last {formatAgo(u.lastAt)}</span>
                    <span className="font-medium">{formatUsd(u.cost)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {goneBranches.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Branches git no longer has</h3>
              <ul className="flex flex-col gap-1.5 text-xs">
                {goneBranches.map((b) => (
                  <li key={b.branch} className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 font-mono [overflow-wrap:anywhere]">{b.branch}</span>
                    <span className="text-muted-foreground">last {formatAgo(b.lastAt)}</span>
                    <span className="font-medium">{formatUsd(b.cost)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
