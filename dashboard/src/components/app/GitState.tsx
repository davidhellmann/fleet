import { TableCell } from '@/components/ui/table';
import type { Project, RepoPresence } from '@/lib/fleet.ts';
import type { GitStatus } from '@/lib/fleet.ts';

/** Why a project has no git state here. */
const ABSENT: Record<RepoPresence, string> = {
  present: 'Not a Git repo',
  missing: 'Not cloned',
  'other-os': 'Other system',
  unknown: 'Run setup',
};

/** "↑2 ↓1", "in sync", "no upstream", "upstream gone". */
export function syncLabel(g: GitStatus): string {
  if (!g.upstream) return 'no upstream';
  if (g.ahead === null || g.behind === null) return 'upstream gone';
  if (g.ahead === 0 && g.behind === 0) return 'in sync';
  return [g.ahead ? `↑${g.ahead}` : '', g.behind ? `↓${g.behind}` : ''].filter(Boolean).join(' ');
}

/** "clean", or "3 changed · 2 untracked · 1 conflict". */
export function changesLabel(g: GitStatus): string {
  const parts = [
    g.conflicts ? `${g.conflicts} conflict${g.conflicts === 1 ? '' : 's'}` : '',
    g.changed ? `${g.changed} changed` : '',
    g.untracked ? `${g.untracked} untracked` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'clean';
}

/**
 * Two table cells of a project's git state: branch with sync, or changes. Text carries the
 * state; the dot only repeats it (amber: needs attention).
 */
export function GitState({ project, part }: { project: Project; part: 'branch' | 'changes' }) {
  const g = project.git;
  if (!g) {
    return part === 'branch'
      ? <TableCell className="text-xs text-muted-foreground">{ABSENT[project.presence]}</TableCell>
      : <TableCell className="text-xs text-muted-foreground">–</TableCell>;
  }
  if (part === 'branch') {
    return (
      <TableCell className="text-xs">
        <span className="font-mono">{g.branch ?? 'detached'}</span>
        <span className="block text-muted-foreground">
          {syncLabel(g)}
          {g.worktrees.length > 0 && ` · ${g.worktrees.length} worktree${g.worktrees.length === 1 ? '' : 's'}`}
        </span>
      </TableCell>
    );
  }
  const attention = g.conflicts > 0 || g.changed > 0;
  return (
    <TableCell className="text-xs">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className={`size-1.5 rounded-full ${g.conflicts ? 'bg-negative' : attention ? 'bg-warning' : 'bg-positive'}`} />
        {changesLabel(g)}
      </span>
    </TableCell>
  );
}
