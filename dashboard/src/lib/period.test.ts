import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, inRange, localDay, parsePeriod, periodRange, withPeriod } from './period.ts';

describe('parsePeriod', () => {
  it('takes the known values and falls back to 30d', () => {
    expect(parsePeriod('today')).toBe('today');
    expect(parsePeriod('1y')).toBe('1y');
    expect(parsePeriod('24h')).toBe('30d');
    expect(parsePeriod(null)).toBe('30d');
  });
});

describe('day arithmetic', () => {
  it('moves across month, year and leap days', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('is not shifted by daylight saving changes', () => {
    // Europe switched on 2026-03-29 and 2026-10-25; days stay whole days
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(31);
  });

  it('reads the local calendar day of an instant', () => {
    expect(localDay(new Date(2026, 10, 18, 23, 59))).toBe('2026-11-18');
    expect(localDay(new Date(2026, 0, 5, 0, 0))).toBe('2026-01-05');
  });

  it('rejects anything but a day', () => {
    expect(() => addDays('18.11.2026', 1)).toThrow(RangeError);
  });
});

describe('periodRange', () => {
  const today = '2026-11-18';

  it('today is one day; yesterday before it', () => {
    expect(periodRange('today', today)).toEqual({
      period: 'today', start: today, end: today, days: 1,
      previous: { start: '2026-11-17', end: '2026-11-17' },
    });
  });

  it('7d is seven days including today, the previous seven directly before', () => {
    const r = periodRange('7d', today);
    expect([r.start, r.end, r.days]).toEqual(['2026-11-12', today, 7]);
    expect(r.previous).toEqual({ start: '2026-11-05', end: '2026-11-11' });
  });

  it('1y is 365 days', () => {
    const r = periodRange('1y', today);
    expect(r.days).toBe(365);
    expect(daysBetween(r.start, r.end)).toBe(365);
    expect(daysBetween(r.previous!.start, r.previous!.end)).toBe(365);
    expect(addDays(r.previous!.end, 1)).toBe(r.start);
  });

  it('all starts at the first day with data and has no previous period', () => {
    expect(periodRange('all', today, '2026-09-01')).toEqual({ period: 'all', start: '2026-09-01', end: today, days: 79, previous: null });
    expect(periodRange('all', today).days).toBe(1);
    expect(periodRange('all', today, '2026-12-01').start).toBe(today);
  });

  it('includes both ends', () => {
    const r = periodRange('7d', today);
    expect(inRange('2026-11-12', r)).toBe(true);
    expect(inRange(today, r)).toBe(true);
    expect(inRange('2026-11-11', r)).toBe(false);
  });
});

describe('withPeriod', () => {
  it('adds the period and leaves the default out', () => {
    expect(withPeriod('/usage', '7d')).toBe('/usage?period=7d');
    expect(withPeriod('/usage?period=7d', '30d')).toBe('/usage');
  });

  it('keeps other parameters', () => {
    expect(withPeriod('/projects?host=studio', 'today')).toBe('/projects?host=studio&period=today');
  });
});
