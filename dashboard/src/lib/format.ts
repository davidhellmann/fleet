import type { Day, DayRange } from './period.ts';

// Days are calendar dates, so they are formatted as UTC dates: no time zone can shift them.
const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const FULL = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const asDate = (day: Day) => new Date(`${day}T00:00:00Z`);

/** "18 Nov 2026" */
export const formatDay = (day: Day): string => FULL.format(asDate(day));

/** "18 Nov 2026", "12 – 18 Nov 2026" style ranges: the year once when both ends share it. */
export function formatRange({ start, end }: DayRange): string {
  if (start === end) return formatDay(end);
  const left = start.slice(0, 4) === end.slice(0, 4) ? DAY_MONTH.format(asDate(start)) : formatDay(start);
  return `${left} – ${formatDay(end)}`;
}

/** Thousands separators, no decimals: "12,345". */
export const formatInt = (n: number): string => Math.round(n).toLocaleString('en-GB');

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const USD_WHOLE = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** "$764.31"; whole dollars from $10,000 on. Amounts under a cent show as "<$0.01". */
export function formatUsd(n: number): string {
  if (n > 0 && n < 0.005) return '<$0.01';
  return Math.abs(n) >= 10_000 ? USD_WHOLE.format(n) : USD.format(n);
}

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** Token counts short: "1.5B", "35.2M", "812". */
export const formatTokens = (n: number): string => COMPACT.format(n);

/** "+12 %", "−8 %", "±0 %" for a fraction; "×14" from ten times on; null stays null. */
export function formatChange(f: number | null): string | null {
  if (f === null || !Number.isFinite(f)) return null;
  // Past ten times the base, a factor reads better than a four-digit percentage
  if (f >= 9) return `×${Math.round(f + 1)}`;
  const pct = Math.round(f * 100);
  if (pct === 0) return '±0 %';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)} %`;
}

/** "just now", "12 min ago", "3 h ago", "5 d ago", "4 mo ago", "2 y ago". */
export function formatAgo(iso: string, now: Date = new Date()): string {
  const s = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86_400 * 60) return `${Math.floor(s / 86_400)} d ago`;
  if (s < 86_400 * 730) return `${Math.floor(s / (86_400 * 30))} mo ago`;
  return `${Math.floor(s / (86_400 * 365))} y ago`;
}

/** "in 40 min", "in 3 h", "in 2 d"; "now" when it has passed. */
export function formatIn(iso: string, now: Date = new Date()): string {
  const s = (Date.parse(iso) - now.getTime()) / 1000;
  if (s <= 0) return 'now';
  if (s < 3600) return `in ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86_400 * 2) return `in ${Math.round(s / 3600)} h`;
  return `in ${Math.round(s / 86_400)} d`;
}

/** "12 %" for a share 0–1; "<1 %" for small, non-zero shares. */
export const formatShare = (f: number): string => (f > 0 && f < 0.005 ? '<1 %' : `${Math.round(f * 100)} %`);
