/**
 * git reader: the state of a checkout (branch, upstream, ahead/behind, changes, last commit,
 * worktrees). Local only, no fetch: ahead/behind is as of the last fetch. Fast enough to run on
 * every page request; the commands of one checkout run in parallel.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface Commit {
  hash: string;
  subject: string;
  /** ISO date of the commit. */
  date: string;
  author: string;
}

export interface Worktree {
  path: string;
  /** Branch checked out there; null when detached. */
  branch: string | null;
}

export interface GitStatus {
  /** Current branch; null when detached. */
  branch: string | null;
  upstream: string | null;
  /** Commits ahead of and behind the upstream, as of the last fetch; null without upstream. */
  ahead: number | null;
  behind: number | null;
  /** Tracked files with changes (staged or not). */
  changed: number;
  untracked: number;
  conflicts: number;
  lastCommit: Commit | null;
  /** Other worktrees of the same repo (the checkout itself left out). */
  worktrees: Worktree[];
}

/** Parses `git status --porcelain=v2 --branch`. */
export function parseStatus(text: string): Pick<GitStatus, 'branch' | 'upstream' | 'ahead' | 'behind' | 'changed' | 'untracked' | 'conflicts'> {
  const s = { branch: null as string | null, upstream: null as string | null, ahead: null as number | null, behind: null as number | null, changed: 0, untracked: 0, conflicts: 0 };
  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice(14).trim();
      s.branch = head === '(detached)' ? null : head;
    } else if (line.startsWith('# branch.upstream ')) {
      s.upstream = line.slice(18).trim();
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) [s.ahead, s.behind] = [+m[1], +m[2]];
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) s.changed++;
    else if (line.startsWith('u ')) s.conflicts++;
    else if (line.startsWith('? ')) s.untracked++;
  }
  return s;
}

/** Parses `git worktree list --porcelain`, leaving out the checkout at `self`. */
export function parseWorktrees(text: string, self: string): Worktree[] {
  const list: Worktree[] = [];
  let current: Worktree | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice(9).trim(), branch: null };
      list.push(current);
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
    }
  }
  const norm = (p: string) => p.replace(/\/+$/, '');
  return list.filter((w) => norm(w.path) !== norm(self));
}

const SEP = '\u001f';

/** Parses `git log -1 --format=%H%x1f%s%x1f%cI%x1f%an`. */
export function parseCommit(text: string): Commit | null {
  const [hash, subject, date, author] = text.trim().split(SEP);
  return hash && date ? { hash, subject: subject ?? '', date, author: author ?? '' } : null;
}

const git = async (dir: string, args: string[]): Promise<string | null> => {
  try {
    const { stdout } = await run('git', ['-C', dir, ...args], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
};

/** The state of the checkout at `dir`; null when it is missing or not a Git repo. */
export async function gitStatus(dir: string): Promise<GitStatus | null> {
  if (!existsSync(dir)) return null;
  const [status, log, worktrees] = await Promise.all([
    git(dir, ['status', '--porcelain=v2', '--branch']),
    git(dir, ['log', '-1', `--format=%H${'%x1f'}%s${'%x1f'}%cI${'%x1f'}%an`]),
    git(dir, ['worktree', 'list', '--porcelain']),
  ]);
  if (status === null) return null;
  return {
    ...parseStatus(status),
    lastCommit: log ? parseCommit(log) : null,
    worktrees: worktrees ? parseWorktrees(worktrees, dir) : [],
  };
}
