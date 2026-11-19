import { describe, expect, it } from 'vitest';
import { orderPulls, pullCosts, type PullRequest } from './pulls.ts';
import type { StatsRow } from './usage.ts';

const row = (day: string, branch: string | null, cost: number): StatsRow => ({
  day, host: 'studio', app: 'claude-code', client: 'cli', repo: 'my-site', branch, model: 'opus',
  sessions: 1, input: 0, output: 10, cacheRead: 0, cacheWrite: 0, cost,
});
const pr = (number: number, branch: string, createdAt: string, endedAt: string | null): PullRequest => ({
  number, title: `#${number}`, url: '', branch, state: endedAt ? 'merged' : 'open', author: null, createdAt, endedAt,
});
const dayOf = (iso: string) => iso.slice(0, 10);

describe('pullCosts', () => {
  it('counts the branch up to the merge, work before the PR included', () => {
    const rows = [row('2026-11-01', 'feat/x', 2), row('2026-11-03', 'feat/x', 3), row('2026-11-05', 'feat/x', 7), row('2026-11-03', 'main', 100)];
    const costs = pullCosts(rows, [pr(1, 'feat/x', '2026-11-02T10:00:00Z', '2026-11-03T18:00:00Z')], '2026-11-18', dayOf);
    expect(costs.get(1)).toEqual({ cost: 5, tokens: 20, days: 2 });
  });

  it('splits a reused branch name at the end of the earlier PR', () => {
    const rows = [row('2026-11-01', 'chore/deps', 1), row('2026-11-10', 'chore/deps', 4), row('2026-11-18', 'chore/deps', 2)];
    const costs = pullCosts(rows, [
      pr(2, 'chore/deps', '2026-11-09T00:00:00Z', null),
      pr(1, 'chore/deps', '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z'),
    ], '2026-11-18', dayOf);
    expect(costs.get(1)!.cost).toBe(1);
    expect(costs.get(2)!.cost).toBe(6);
  });

  it('gives a PR without usage zero', () => {
    expect(pullCosts([], [pr(3, 'feat/y', '2026-11-01T00:00:00Z', null)], '2026-11-18', dayOf).get(3)).toEqual({ cost: 0, tokens: 0, days: 0 });
  });
});

describe('orderPulls', () => {
  it('puts open ones first, then the latest ended', () => {
    const order = orderPulls([pr(1, 'a', '2026-11-01', '2026-11-02'), pr(2, 'b', '2026-11-03', null), pr(3, 'c', '2026-11-01', '2026-11-10')]);
    expect(order.map((p) => p.number)).toEqual([2, 3, 1]);
  });
});
