/**
 * Cost per commit, estimated. The logs name no commits (agents commit quietly or people commit
 * themselves), so every reply on a branch is assigned to the first commit that landed on that branch
 * after it (`git log --first-parent`, committer time). Replies after the last commit are uncommitted
 * work. Exploration that led nowhere lands on the next commit; a rebase gives the work new hashes.
 *
 * Needs the reply timestamps, which the daily rollups drop, so it runs in the collector while the
 * logs exist and is stored per commit in stats/<host>/commits-<YYYY-MM>.json.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { UsageEvent } from './claude.ts';

const run = promisify(execFile);

/** A reply with its repo and price, ready to assign. */
export interface PricedEvent extends UsageEvent {
  repo: string;
  cost: number | null;
}

export interface CommitRef {
  hash: string;
  /** Committer time: when it landed on the branch. */
  at: string;
  subject: string;
}

export interface CommitRow {
  hash: string;
  /** Local day the commit landed. */
  day: string;
  host: string;
  repo: string;
  branch: string;
  /** First line of the message, at most 100 characters. */
  subject: string;
  /** First and last reply assigned to it. */
  firstAt: string;
  lastAt: string;
  replies: number;
  sessions: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** USD; null when a model had no price. */
  cost: number | null;
}

/** Cost on a branch that git no longer has (deleted after a merge, or an agent's worktree). */
export interface GoneBranch {
  repo: string;
  branch: string;
  lastAt: string;
  cost: number;
}

/** Work after the last commit on a branch. */
export interface Uncommitted {
  repo: string;
  branch: string;
  since: string;
  lastAt: string;
  replies: number;
  cost: number;
}

const SEP = '\u001f';

/** Parses `git log --format=%H%x1f%cI%x1f%s`, oldest first. */
export function parseLog(text: string): CommitRef[] {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, at, subject = ''] = line.split(SEP);
      return { hash, at, subject: subject.slice(0, 100) };
    })
    .filter((c) => c.hash && !Number.isNaN(Date.parse(c.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

const roundCost = (usd: number) => Math.round(usd * 10_000) / 10_000;

/**
 * Assigns the events of one repo and branch to `commits` (oldest first). Returns one row per commit
 * that received work, and the work after the last commit.
 */
export function assign(
  events: readonly PricedEvent[],
  commits: readonly CommitRef[],
  ctx: { host: string; repo: string; branch: string; dayOf: (iso: string) => string },
): { rows: CommitRow[]; uncommitted: Uncommitted | null } {
  const times = commits.map((c) => Date.parse(c.at));
  const groups = new Map<number, PricedEvent[]>();
  const after: PricedEvent[] = [];
  for (const e of [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    const t = Date.parse(e.timestamp);
    // First commit at or after the reply (binary search over sorted times)
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    if (lo === times.length) after.push(e);
    else groups.set(lo, [...(groups.get(lo) ?? []), e]);
  }

  const rows: CommitRow[] = [...groups].map(([i, list]) => {
    const c = commits[i];
    const priced = list.every((e) => e.cost !== null);
    return {
      hash: c.hash,
      day: ctx.dayOf(c.at),
      host: ctx.host,
      repo: ctx.repo,
      branch: ctx.branch,
      subject: c.subject,
      firstAt: list[0].timestamp,
      lastAt: list.at(-1)!.timestamp,
      replies: list.length,
      sessions: new Set(list.map((e) => e.sessionId)).size,
      input: list.reduce((a, e) => a + e.input, 0),
      output: list.reduce((a, e) => a + e.output, 0),
      cacheRead: list.reduce((a, e) => a + e.cacheRead, 0),
      cacheWrite: list.reduce((a, e) => a + e.cacheWrite5m + e.cacheWrite1h, 0),
      cost: priced ? roundCost(list.reduce((a, e) => a + (e.cost ?? 0), 0)) : null,
    };
  });
  const uncommitted = after.length
    ? { repo: ctx.repo, branch: ctx.branch, since: after[0].timestamp, lastAt: after.at(-1)!.timestamp, replies: after.length, cost: roundCost(after.reduce((a, e) => a + (e.cost ?? 0), 0)) }
    : null;
  return { rows, uncommitted };
}

/**
 * Commits on `branch` in the repo at `dir` since `since` (ISO), first parent only, oldest first.
 * Falls back to `origin/<branch>` when the local branch is gone; null when neither exists.
 */
export async function branchLog(dir: string, branch: string, since: string): Promise<CommitRef[] | null> {
  // A margin before the first reply is not needed (commits come after replies), but `--since`
  // compares commit dates loosely; one day earlier is safe.
  const from = new Date(Date.parse(since) - 86_400_000).toISOString();
  for (const ref of [branch, `origin/${branch}`]) {
    try {
      const { stdout } = await run('git', ['-C', dir, 'log', ref, '--first-parent', `--since=${from}`, `--format=%H${'%x1f'}%cI${'%x1f'}%s`, '--'], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
      return parseLog(stdout);
    } catch {}
  }
  return null;
}

/**
 * Merges fresh commit rows into the stored ones. A stored commit is recomputed only when all of its
 * replies are still in the logs (`firstAt` on or after `recomputeFrom`); otherwise the stored row
 * stays. New commits are added. On every branch in `computed` (`repo:branch`), stored commits inside
 * the window that the branch no longer has (rebased, amended) are dropped, so work is not counted
 * twice under old and new hashes.
 */
export function mergeCommitRows(stored: readonly CommitRow[], fresh: readonly CommitRow[], recomputeFrom: string, computed: ReadonlySet<string>): CommitRow[] {
  const freshKeys = new Set(fresh.map((r) => `${r.repo}:${r.hash}`));
  const kept = stored.filter((r) => !(computed.has(`${r.repo}:${r.branch}`) && r.firstAt.slice(0, 10) >= recomputeFrom && !freshKeys.has(`${r.repo}:${r.hash}`)));
  const byHash = new Map(kept.map((r) => [`${r.repo}:${r.hash}`, r]));
  for (const r of fresh) {
    const key = `${r.repo}:${r.hash}`;
    const old = byHash.get(key);
    if (!old || r.firstAt.slice(0, 10) >= recomputeFrom) byHash.set(key, r);
  }
  return [...byHash.values()].sort((a, b) => a.day.localeCompare(b.day) || a.firstAt.localeCompare(b.firstAt) || a.hash.localeCompare(b.hash));
}
