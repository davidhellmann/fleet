import { describe, expect, it } from 'vitest';
import { activity, breakdown, bucketFor, bucketStart, change, firstDay, rowsIn, timeline, totals, type StatsRow } from './usage.ts';

const row = (o: Partial<StatsRow>): StatsRow => ({
  day: '2026-11-18', host: 'studio', app: 'claude-code', client: 'cli', repo: 'my-site', branch: 'main', model: 'opus',
  sessions: 1, input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 1, ...o,
});

describe('totals', () => {
  it('sums tokens and cost and counts active days', () => {
    const t = totals([row({}), row({ cost: 2 }), row({ day: '2026-11-17', cost: null })]);
    expect(t).toMatchObject({ cost: 3, tokens: 30, output: 6, activeDays: 2, unpriced: true });
  });
});

describe('ranges and change', () => {
  it('filters by range and finds the first day', () => {
    const rows = [row({ day: '2026-11-01' }), row({ day: '2026-11-10' }), row({ day: '2026-11-18' })];
    expect(rowsIn(rows, { start: '2026-11-10', end: '2026-11-18' })).toHaveLength(2);
    expect(firstDay(rows)).toBe('2026-11-01');
    expect(firstDay([])).toBeNull();
  });

  it('reports change only against a base', () => {
    expect(change(15, 10)).toBeCloseTo(0.5);
    expect(change(5, 0)).toBeNull();
    expect(change(5, null)).toBeNull();
  });
});

describe('breakdown', () => {
  it('groups, shares and sorts by cost', () => {
    const b = breakdown([row({ repo: 'a', cost: 1 }), row({ repo: 'b', cost: 3 }), row({ repo: 'a', cost: 1 })], 'repo');
    expect(b.map((s) => [s.label, s.cost, s.share])).toEqual([['b', 3, 0.6], ['a', 2, 0.4]]);
  });
});

describe('timeline', () => {
  it('picks day, week or month buckets by the length of the range', () => {
    expect(bucketFor(30)).toBe('day');
    expect(bucketFor(365)).toBe('week');
    expect(bucketFor(500)).toBe('month');
    expect(bucketStart('2026-11-18', 'week')).toBe('2026-11-16');
    expect(bucketStart('2026-11-18', 'month')).toBe('2026-11-01');
  });

  it('keeps every bucket, the top series and sums the rest as Other', () => {
    const rows = [
      row({ day: '2026-11-16', model: 'a', cost: 5 }),
      row({ day: '2026-11-16', model: 'b', cost: 3 }),
      row({ day: '2026-11-18', model: 'c', cost: 1 }),
      row({ day: '2026-11-18', model: 'd', cost: 1 }),
    ];
    const t = timeline(rows, { start: '2026-11-15', end: '2026-11-18' }, 'model', 2);
    expect(t.bucket).toBe('day');
    expect(t.buckets).toEqual(['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18']);
    expect(t.series).toEqual(['a', 'b', 'Other']);
    expect(t.points.map((p) => [p.bucket, p.series, p.cost])).toEqual([
      ['2026-11-16', 'a', 5],
      ['2026-11-16', 'b', 3],
      ['2026-11-18', 'Other', 2],
    ]);
  });

  it('runs month buckets across a year end', () => {
    const t = timeline([row({ day: '2027-01-03', cost: 1 })], { start: '2025-11-20', end: '2027-01-05' }, 'model');
    expect(t.bucket).toBe('month');
    expect(t.buckets[0]).toBe('2025-11-01');
    expect(t.buckets.at(-1)).toBe('2027-01-01');
    expect(t.buckets).toHaveLength(15);
    expect(t.series).toEqual(['opus']);
  });
});

describe('activity', () => {
  it('lays out whole weeks, Monday first, ending in the week of today', () => {
    // 2026-11-18 is a Wednesday: the grid ends with Thu–Sun of that week as null
    const cells = activity([], '2026-11-18', 2);
    expect(cells).toHaveLength(14);
    expect(cells[0]!.day).toBe('2026-11-09');
    expect(cells[9]!.day).toBe('2026-11-18');
    expect(cells.slice(10)).toEqual([null, null, null, null]);
  });

  it('levels days by quartiles of cost; unpriced activity still shows', () => {
    const rows = [1, 2, 3, 4].map((c, i) => row({ day: `2026-11-1${i}`, cost: c }));
    rows.push(row({ day: '2026-11-15', cost: null }));
    const cells = activity(rows, '2026-11-18', 2).filter(Boolean);
    const level = (day: string) => cells.find((c) => c!.day === day)!.level;
    expect([level('2026-11-10'), level('2026-11-11'), level('2026-11-12'), level('2026-11-13')]).toEqual([1, 2, 3, 4]);
    expect(level('2026-11-15')).toBe(1);
    expect(level('2026-11-16')).toBe(0);
  });
});

describe('formatChange', async () => {
  const { formatChange } = await import('./format.ts');
  it('shows percent, and a factor from ten times on', () => {
    expect(formatChange(0.25)).toBe('+25 %');
    expect(formatChange(-0.081)).toBe('−8 %');
    expect(formatChange(0.001)).toBe('±0 %');
    expect(formatChange(8.99)).toBe('+899 %');
    expect(formatChange(138.2)).toBe('×139');
    expect(formatChange(null)).toBeNull();
  });
});
