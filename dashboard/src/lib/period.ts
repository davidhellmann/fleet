/**
 * Periods of the dashboard: today, 7 d, 30 d, 1 y, all. Pure, no clock: the caller passes today.
 *
 * Every period is whole local calendar days ending with today (docs/dashboard.md):
 * N days including today, the previous period the N days directly before. All starts at the first
 * day with data and has no previous period. Days are local `YYYY-MM-DD` strings, the key of the
 * daily rollups in stats/, so they compare and sort as text.
 */

export const PERIODS = ['today', '7d', '30d', '1y', 'all'] as const;
export type Period = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: Period = '30d';

/** Labels for the period switch. */
export const PERIOD_LABELS: Record<Period, string> = { today: 'Today', '7d': '7 d', '30d': '30 d', '1y': '1 y', all: 'All' };
/** Accessible names, where the short label is too terse. */
export const PERIOD_NAMES: Record<Period, string> = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', '1y': 'Last year', all: 'All time' };

const LENGTH: Record<Exclude<Period, 'all'>, number> = { today: 1, '7d': 7, '30d': 30, '1y': 365 };

/** A local calendar day, `YYYY-MM-DD`. */
export type Day = string;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isPeriod = (value: unknown): value is Period => (PERIODS as readonly unknown[]).includes(value);

/** The period of a URL value (`?period=`); anything else is the default. */
export const parsePeriod = (value: string | null | undefined): Period => (isPeriod(value) ? value : DEFAULT_PERIOD);

/** The local calendar day of an instant. */
export function localDay(date: Date): Day {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Day arithmetic in UTC, where every day has 24 hours; the day itself stays a local calendar day.
function toUtc(day: Day): number {
  const m = DAY.exec(day);
  if (!m) throw new RangeError(`not a day: ${day}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
const fromUtc = (ms: number): Day => new Date(ms).toISOString().slice(0, 10);

/** `day` moved by `n` days (negative: back). */
export const addDays = (day: Day, n: number): Day => fromUtc(toUtc(day) + n * 86_400_000);

/** Days from `a` to `b`, both included: the same day is 1. */
export const daysBetween = (a: Day, b: Day): number => Math.round((toUtc(b) - toUtc(a)) / 86_400_000) + 1;

export interface DayRange {
  start: Day;
  end: Day;
}

export interface PeriodRange extends DayRange {
  period: Period;
  /** Calendar days in the range. */
  days: number;
  /** The same number of days directly before; null for all. */
  previous: DayRange | null;
}

/**
 * The days of `period`, ending with `today`. `firstDay` is the first day with data; it only
 * matters for all (without it, or when it lies after today, all is just today).
 */
export function periodRange(period: Period, today: Day, firstDay?: Day | null): PeriodRange {
  toUtc(today);
  if (period === 'all') {
    const start = firstDay && firstDay < today ? firstDay : today;
    return { period, start, end: today, days: daysBetween(start, today), previous: null };
  }
  const days = LENGTH[period];
  const start = addDays(today, -(days - 1));
  return { period, start, end: today, days, previous: { start: addDays(start, -days), end: addDays(start, -1) } };
}

/** Whether `day` lies in `range`, both ends included. */
export const inRange = (day: Day, range: DayRange): boolean => day >= range.start && day <= range.end;

/**
 * `href` carrying `period`, so links keep it. The default period is left out of the URL; any other
 * query parameter is kept.
 */
export function withPeriod(href: string, period: Period): string {
  const [path, query = ''] = href.split('?', 2);
  const params = new URLSearchParams(query);
  if (period === DEFAULT_PERIOD) params.delete('period');
  else params.set('period', period);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
