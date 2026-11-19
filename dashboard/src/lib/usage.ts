/**
 * Usage figures for the pages, from the daily rollups in stats/. Pure: rows in, figures out.
 */
import type { StatsRow } from '../../collect/rollup.ts';
import { addDays, inRange, type Day, type DayRange } from './period.ts';

export type { StatsRow };

/** Dimensions a page can break usage down by. */
export type UsageDimension = 'app' | 'client' | 'model' | 'repo' | 'host' | 'branch';

/** The value of a row in `dimension`; rows without a branch read as `(no branch)`. */
const valueOf = (r: StatsRow, dimension: UsageDimension): string => r[dimension] ?? '(no branch)';

export interface UsageTotals {
  /** USD at API list prices; rows without a price count 0. */
  cost: number;
  /** Every token: input, output, cache read and cache write. */
  tokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Days with any usage. */
  activeDays: number;
  /** Whether some rows had no price (cost is then a lower bound). */
  unpriced: boolean;
}

export const rowsIn = (rows: readonly StatsRow[], range: DayRange): StatsRow[] => rows.filter((r) => inRange(r.day, range));

/** The first day with usage, or null. */
export const firstDay = (rows: readonly StatsRow[]): Day | null => rows.reduce<Day | null>((min, r) => (min === null || r.day < min ? r.day : min), null);

const tokensOf = (r: StatsRow) => r.input + r.output + r.cacheRead + r.cacheWrite;

export function totals(rows: readonly StatsRow[]): UsageTotals {
  const t: UsageTotals = { cost: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, activeDays: 0, unpriced: false };
  const days = new Set<string>();
  for (const r of rows) {
    t.cost += r.cost ?? 0;
    if (r.cost === null) t.unpriced = true;
    t.input += r.input;
    t.output += r.output;
    t.cacheRead += r.cacheRead;
    t.cacheWrite += r.cacheWrite;
    days.add(r.day);
  }
  t.tokens = t.input + t.output + t.cacheRead + t.cacheWrite;
  t.activeDays = days.size;
  return t;
}

/** Change from `previous` to `current` as a fraction (0.25 = +25 %); null without a base to compare. */
export const change = (current: number, previous: number | null | undefined): number | null =>
  previous === null || previous === undefined || previous === 0 ? null : (current - previous) / previous;

export interface Share {
  label: string;
  cost: number;
  tokens: number;
  /** Share of the total cost, 0–1. */
  share: number;
}

/** Usage per value of `dimension`, most expensive first. */
export function breakdown(rows: readonly StatsRow[], dimension: UsageDimension): Share[] {
  const by = new Map<string, { cost: number; tokens: number }>();
  let total = 0;
  for (const r of rows) {
    const key = valueOf(r, dimension);
    const s = by.get(key) ?? { cost: 0, tokens: 0 };
    s.cost += r.cost ?? 0;
    s.tokens += tokensOf(r);
    by.set(key, s);
    total += r.cost ?? 0;
  }
  return [...by]
    .map(([label, s]) => ({ label, ...s, share: total > 0 ? s.cost / total : 0 }))
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens || a.label.localeCompare(b.label));
}

export type Bucket = 'day' | 'week' | 'month';

export interface TimelinePoint {
  /** Stable key for the chart: bucket and series. */
  id: string;
  /** First day of the bucket (a Monday for weeks, the 1st for months). */
  bucket: Day;
  series: string;
  cost: number;
}

export interface Timeline {
  bucket: Bucket;
  /** Every bucket of the range in order, also those without usage, so the axis has no gaps. */
  buckets: Day[];
  /** Series in stacking order: most expensive first, `Other` last. */
  series: string[];
  points: TimelinePoint[];
}

export const OTHER_SERIES = 'Other';

/** Day buckets up to 31 days, weeks up to a year, months beyond. */
export const bucketFor = (days: number): Bucket => (days <= 31 ? 'day' : days <= 366 ? 'week' : 'month');

/** First day of the bucket holding `day`. */
export function bucketStart(day: Day, bucket: Bucket): Day {
  if (bucket === 'day') return day;
  if (bucket === 'month') return `${day.slice(0, 7)}-01`;
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(day, -weekday);
}

/**
 * Cost over time within `range`, split by `dimension`: the `maxSeries` most expensive values on
 * their own, the rest summed as `Other`.
 */
export function timeline(rows: readonly StatsRow[], range: DayRange, dimension: UsageDimension, maxSeries = 5): Timeline {
  const days = Math.round((Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86_400_000) + 1;
  const bucket = bucketFor(days);

  const buckets: Day[] = [];
  for (let d = bucketStart(range.start, bucket); d <= range.end; ) {
    buckets.push(d);
    d = bucket === 'day' ? addDays(d, 1) : bucket === 'week' ? addDays(d, 7) : bucketStart(addDays(d, 31), 'month');
  }

  const ranked = breakdown(rows, dimension).filter((s) => s.cost > 0);
  const named = new Set(ranked.slice(0, ranked.length > maxSeries ? maxSeries : ranked.length).map((s) => s.label));
  const series = [...named];
  if (ranked.length > named.size) series.push(OTHER_SERIES);

  const sums = new Map<string, TimelinePoint>();
  for (const r of rows) {
    if (!inRange(r.day, range) || !r.cost) continue;
    const label = valueOf(r, dimension);
    const s = named.has(label) ? label : OTHER_SERIES;
    const b = bucketStart(r.day, bucket);
    const id = `${b}:${s}`;
    const p = sums.get(id) ?? { id, bucket: b, series: s, cost: 0 };
    p.cost += r.cost;
    sums.set(id, p);
  }
  // Points in bucket order, then stacking order, so the stack never reshuffles
  const order = new Map(series.map((s, i) => [s, i]));
  const points = [...sums.values()].sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : order.get(a.series)! - order.get(b.series)!));
  return { bucket, buckets, series, points };
}

export interface ActivityCell {
  day: Day;
  cost: number;
  tokens: number;
  /** Sessions summed over the day's rollup rows (a session spanning two models or repos counts twice). */
  sessions: number;
  /** 0 = nothing, 1–4 = quartile of the active days' cost. */
  level: 0 | 1 | 2 | 3 | 4;
}

/**
 * The activity calendar: `weeks` full weeks Monday → Sunday, the last one holding `today`. Days after
 * today are null. Levels are quartiles of the cost of active days, so one expensive day does not
 * flatten the rest.
 */
export function activity(rows: readonly StatsRow[], today: Day, weeks = 53): (ActivityCell | null)[] {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const start = addDays(today, -weekday - (weeks - 1) * 7);
  const byDay = new Map<Day, { cost: number; tokens: number; sessions: number }>();
  for (const r of rows) {
    if (r.day < start || r.day > today) continue;
    const d = byDay.get(r.day) ?? { cost: 0, tokens: 0, sessions: 0 };
    d.cost += r.cost ?? 0;
    d.tokens += tokensOf(r);
    d.sessions += r.sessions;
    byDay.set(r.day, d);
  }
  // Level = quarter of the cost rank among active days: ⌈4 · rank / n⌉
  const costs = [...byDay.values()].map((d) => d.cost).filter((c) => c > 0);
  const level = (c: number): ActivityCell['level'] => {
    if (c <= 0) return 0;
    const rank = costs.filter((x) => x <= c).length;
    return Math.max(1, Math.ceil((4 * rank) / costs.length)) as ActivityCell['level'];
  };

  const cells: (ActivityCell | null)[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const day = addDays(start, i);
    if (day > today) {
      cells.push(null);
      continue;
    }
    const d = byDay.get(day) ?? { cost: 0, tokens: 0, sessions: 0 };
    // A day with tokens but no price still shows as active
    cells.push({ day, ...d, level: d.cost > 0 ? level(d.cost) : d.tokens > 0 ? 1 : 0 });
  }
  return cells;
}
