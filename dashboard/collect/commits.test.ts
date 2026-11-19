import { describe, expect, it } from 'vitest';
import { assign, mergeCommitRows, parseLog, type CommitRow, type PricedEvent } from './commits.ts';

const ev = (timestamp: string, cost: number | null = 1, sessionId = 's1'): PricedEvent => ({
  app: 'claude-code', client: 'cli', sessionId, timestamp, cwd: '/x', branch: 'main', model: 'opus', repo: 'my-site',
  input: 1, output: 2, cacheRead: 3, cacheWrite5m: 4, cacheWrite1h: 5, cost,
});
const ctx = { host: 'studio', repo: 'my-site', branch: 'main', dayOf: (iso: string) => iso.slice(0, 10) };

describe('parseLog', () => {
  it('reads hash, time and subject, oldest first, subject cut to 100', () => {
    const text = `b\u001f2026-11-18T12:00:00+01:00\u001fsecond\na\u001f2026-11-18T10:00:00+01:00\u001f${'x'.repeat(120)}\n`;
    const log = parseLog(text);
    expect(log.map((c) => c.hash)).toEqual(['a', 'b']);
    expect(log[0].subject).toHaveLength(100);
  });
});

describe('assign', () => {
  const commits = [
    { hash: 'c1', at: '2026-11-18T10:00:00Z', subject: 'first' },
    { hash: 'c2', at: '2026-11-18T12:00:00Z', subject: 'second' },
  ];

  it('gives each reply to the first commit after it; later replies are uncommitted', () => {
    const { rows, uncommitted } = assign([
      ev('2026-11-18T09:00:00Z'), ev('2026-11-18T10:00:00Z', 1, 's2'), // up to and at c1
      ev('2026-11-18T11:00:00Z', 2), // c2
      ev('2026-11-18T13:00:00Z', 4), ev('2026-11-18T14:00:00Z', 4), // after the last commit
    ], commits, ctx);
    expect(rows.map((r) => [r.hash, r.replies, r.sessions, r.cost, r.cacheWrite, r.firstAt])).toEqual([
      ['c1', 2, 2, 2, 18, '2026-11-18T09:00:00Z'],
      ['c2', 1, 1, 2, 9, '2026-11-18T11:00:00Z'],
    ]);
    expect(uncommitted).toMatchObject({ replies: 2, cost: 8, since: '2026-11-18T13:00:00Z' });
  });

  it('leaves the cost empty when a reply has no price', () => {
    expect(assign([ev('2026-11-18T09:00:00Z', null)], commits, ctx).rows[0].cost).toBeNull();
  });

  it('puts everything into uncommitted without commits', () => {
    const r = assign([ev('2026-11-18T09:00:00Z')], [], ctx);
    expect(r.rows).toEqual([]);
    expect(r.uncommitted?.replies).toBe(1);
  });
});

describe('mergeCommitRows', () => {
  const row = (hash: string, firstAt: string, cost: number, branch = 'main'): CommitRow => ({
    hash, day: firstAt.slice(0, 10), host: 'studio', repo: 'my-site', branch, subject: hash, firstAt, lastAt: firstAt,
    replies: 1, sessions: 1, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost,
  });
  const computed = new Set(['my-site:main']);

  it('recomputes commits inside the window, keeps older ones, adds new ones', () => {
    const stored = [row('old', '2026-10-01T10:00:00Z', 10), row('recent', '2026-11-10T10:00:00Z', 10)];
    const fresh = [row('old', '2026-10-01T10:00:00Z', 3), row('recent', '2026-11-10T10:00:00Z', 5), row('new', '2026-11-18T10:00:00Z', 1)];
    const merged = mergeCommitRows(stored, fresh, '2026-11-01', computed);
    expect(merged.map((r) => [r.hash, r.cost])).toEqual([['old', 10], ['recent', 5], ['new', 1]]);
  });

  it('drops commits a recomputed branch no longer has (rebase), but only inside the window', () => {
    const stored = [row('before-rebase', '2026-11-10T10:00:00Z', 5), row('ancient', '2026-10-01T10:00:00Z', 2), row('elsewhere', '2026-11-10T10:00:00Z', 1, 'feat/x')];
    const fresh = [row('after-rebase', '2026-11-10T10:00:00Z', 5)];
    const merged = mergeCommitRows(stored, fresh, '2026-11-01', computed);
    expect(merged.map((r) => r.hash).sort()).toEqual(['after-rebase', 'ancient', 'elsewhere']);
  });
});
