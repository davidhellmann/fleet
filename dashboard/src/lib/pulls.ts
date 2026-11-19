/**
 * Cost per pull request, from the daily rollups: the rows on the PR's head branch in its repo, from
 * the day after the previous PR on the same branch name ended (or from the start) to the day this
 * one was merged or closed (or today while open). Work before the PR was opened counts, as it is
 * usually where most of it happens. Pure.
 */
import type { PullRequest } from '../../collect/github.ts';
import { addDays, inRange, localDay, type Day } from './period.ts';
import type { StatsRow } from './usage.ts';

export type { PullRequest };

export interface PullCost {
  cost: number;
  tokens: number;
  /** Days with usage on the branch in the PR's span. */
  days: number;
}

/**
 * Cost of each PR by number. `rows` are the repo's rows; `dayOf` turns an ISO instant into the local
 * day (injectable for tests).
 */
export function pullCosts(rows: readonly StatsRow[], pulls: readonly PullRequest[], today: Day, dayOf: (iso: string) => Day = (iso) => localDay(new Date(iso))): Map<number, PullCost> {
  const out = new Map<number, PullCost>();
  const byBranch = new Map<string, PullRequest[]>();
  for (const p of pulls) {
    if (!p.branch) continue;
    const list = byBranch.get(p.branch) ?? [];
    list.push(p);
    byBranch.set(p.branch, list);
  }
  for (const [branch, list] of byBranch) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const onBranch = rows.filter((r) => r.branch === branch);
    let start: Day = '0000-01-01';
    for (const p of list) {
      const end = p.endedAt ? dayOf(p.endedAt) : today;
      const span = { start, end };
      const mine = onBranch.filter((r) => inRange(r.day, span));
      out.set(p.number, {
        cost: mine.reduce((a, r) => a + (r.cost ?? 0), 0),
        tokens: mine.reduce((a, r) => a + r.input + r.output + r.cacheRead + r.cacheWrite, 0),
        days: new Set(mine.map((r) => r.day)).size,
      });
      start = addDays(end, 1);
    }
  }
  return out;
}

/** Open first (newest first), then the rest by when they ended. */
export const orderPulls = (pulls: readonly PullRequest[]): PullRequest[] =>
  [...pulls].sort((a, b) => {
    const openA = a.endedAt === null;
    const openB = b.endedAt === null;
    if (openA !== openB) return openA ? -1 : 1;
    return (b.endedAt ?? b.createdAt).localeCompare(a.endedAt ?? a.createdAt);
  });
