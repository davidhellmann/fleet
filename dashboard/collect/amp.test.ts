import { describe, expect, it } from 'vitest';
import { ampDaysToRead, ampModelId, ampRows, ampThreadRows, amount, mergeAmpRows, parseAmpReport, parseTier, readAmpUsage } from './amp.ts';
import { addDays } from '../src/lib/period.ts';

// The shape of `amp usage --details` (Nov 2026), with made-up threads
const REPORT = `# Usage

Signed in as someone@example.com (someone)
**Amp Megawatt Tier:** agent usage $19.02 of $20.00 remaining (95%), orb usage 715.4h of 750h a1.small orb hours remaining (95%) - period 2026-11-17 to 2026-12-17, resets upon renewal in 28 days
**Individual credits:** $0.00 remaining - https://ampcode.com/settings

## How Usage Is Charged

- Models served by Amp: the token list price.

Range: 2026-11-17T23:00:00.000Z to 2026-11-18T23:00:00.000Z (end exclusive)
Total tokens: 429,063,760

## Models

Sorted by recorded cost. Uncached input, cache read, cache write, and output tokens add up to Tokens.

| Model | Uncached input | Cache read | Cache write | Output | Tokens | Recorded cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| gpt-image-2.6-sunburst | 19,652 | 0 | 0 | 10,002 | 29,654 | $0.45 |
| GPT-Live 1 | 0 | 0 | 0 | 0 | 0 | $0.41 |
| Opus 5.5 | 2,000 | 1,000,000 | 100,000 | 50,000 | 1,152,000 | $0.00 |
| GPT-6.1 Terra | 140,198 | 0 | 0 | 5,040 | 145,238 | $0.00 |

## Daily Recorded Cost

| Date (UTC) | Included orb hours | Covered | Paid | Total |
| --- | ---: | ---: | ---: | ---: |
| 2026-11-18 | 24.6h | $0.51 | $0.00 | $0.51 |

## Usage by Thread

| Thread | Tokens | Orb runtime | Included orb hours | Covered | Paid | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Build the thing (T-01a1aaaa-0000-7000-8000-000000000001) | 1,000,000 | 6.6h (larger than a1.small, 2×) | 13.2h | $0.44 | $0.00 | $0.44 |
  <!-- Run \`amp threads usage T-01a1aaaa-0000-7000-8000-000000000001 --details\` for detail. -->
| Small question (T-01a1aaaa-0000-7000-8000-000000000002) | 326,892 | 0h | 0h | $0.00 | $0.00 | $0.00 |

<!-- Account and thread usage lookups share a limit of 60 requests per hour. -->
`;

describe('Amp report', () => {
  it('reads amounts with separators, dollars and hours', () => {
    expect([amount('1,234'), amount('$0.45'), amount('34.6h'), amount('**$0.98**'), amount('6.6h (larger than a1.small, 2×)'), amount('–')]).toEqual([1234, 0.45, 34.6, 0.98, 6.6, null]);
  });

  it('maps model names to price list ids', () => {
    expect(['Opus 5.5', 'Fable 5.2', 'Sonnet 5', 'GPT-6 Astra', 'GPT-6.1 Terra', 'gpt-image-2.6-sunburst'].map(ampModelId))
      .toEqual(['claude-opus-5-5', 'claude-fable-5-2', 'claude-sonnet-5', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-image-2.6-sunburst']);
  });

  it('reads range, models with every token kind, and threads', () => {
    const r = parseAmpReport(REPORT, '2026-11-19T00:00:00Z');
    expect(r.range).toEqual({ start: '2026-11-17T23:00:00.000Z', end: '2026-11-18T23:00:00.000Z' });
    expect(r.models.find((m) => m.model === 'claude-opus-5-5')).toMatchObject({ input: 2000, cacheRead: 1_000_000, cacheWrite: 100_000, output: 50_000, recordedCost: 0 });
    expect(r.threads).toEqual([
      { id: 'T-01a1aaaa-0000-7000-8000-000000000001', title: 'Build the thing', tokens: 1_000_000, orbHours: 13.2, recordedCost: 0.44 },
      { id: 'T-01a1aaaa-0000-7000-8000-000000000002', title: 'Small question', tokens: 326_892, orbHours: 0, recordedCost: 0 },
    ]);
  });

  it('reads the tier as used shares of agent dollars and orb hours', () => {
    const t = parseTier(REPORT, 'x')!;
    expect(t.plan).toBe('Megawatt');
    expect(t.windows.map((w) => [w.label, Math.round(w.usedPercent * 10) / 10, w.resetsAt])).toEqual([
      ['agent $', 4.9, '2026-12-17T00:00:00.000Z'],
      ['orb hours', 4.6, '2026-12-17T00:00:00.000Z'],
    ]);
  });
});

describe('Amp rows', () => {
  const report = parseAmpReport(REPORT, 'x');
  const priceOf = (m: string) => (m === 'claude-opus-5-5' ? { input: 1e-6, output: 1e-5, cacheRead: 1e-7, cacheWrite5m: 2e-6 } : null);

  it('prices models with tokens at list price, others at recorded cost; threads counted once', () => {
    const rows = ampRows(report, { day: '2026-11-18', host: 'studio', priceOf });
    expect(rows.map((r) => [r.model, r.cost, r.sessions])).toEqual([
      ['gpt-image-2.6-sunburst', 0.45, 0],
      ['gpt-live-1', 0.41, 0],
      ['claude-opus-5-5', 0.002 + 0.5 + 0.1 + 0.2, 2],
      ['gpt-6.1-terra', 0, 0],
    ]);
    expect(rows[0]).toMatchObject({ app: 'amp', client: 'amp', repo: 'other', branch: null, host: 'studio' });
  });

  it('makes one thread row per thread and day', () => {
    expect(ampThreadRows(report, { day: '2026-11-18', host: 'studio' }).map((t) => [t.day, t.thread.slice(-1), t.tokens])).toEqual([['2026-11-18', '1', 1_000_000], ['2026-11-18', '2', 326_892]]);
  });
});

describe('Amp days and merge', () => {
  it('reads today, yesterday, then the oldest missing days', () => {
    const known = new Set(['2026-08-23', '2026-08-24']);
    const days = ampDaysToRead('2026-11-19', known, 3, addDays);
    expect(days).toEqual(['2026-11-19', '2026-11-18', '2026-08-25', '2026-08-26', '2026-08-27']);
  });

  it('changes only days read in this run; a failed day keeps its rows', () => {
    const row = (day: string, cost: number, app = 'amp') => ({ day, app, cost });
    const stored = [row('2026-11-19', 1), row('2026-11-18', 1), row('2026-09-01', 1), row('2026-11-18', 5, 'pi')];
    const fresh = [row('2026-11-18', 2), row('2026-09-01', 9), row('2026-09-02', 3)];
    const merged = mergeAmpRows(stored, fresh, new Set(['2026-11-18', '2026-09-01', '2026-09-02']), '2026-11-18');
    expect(merged.map((r) => [r.day, r.app, r.cost]).sort()).toEqual([
      ['2026-09-01', 'amp', 1], // older and stored: kept
      ['2026-09-02', 'amp', 3], // older and missing: filled
      ['2026-11-18', 'amp', 2], // recent and read: replaced
      ['2026-11-18', 'pi', 5], // other app: untouched
      ['2026-11-19', 'amp', 1], // not read (failed): kept
    ]);
  });
});

describe('readAmpUsage', () => {
  it('passes the range and parses the report', async () => {
    let args: string[] = [];
    const r = await readAmpUsage('2026-11-17T23:00:00.000Z', '2026-11-18T23:00:00.000Z', async (a) => { args = a; return REPORT; });
    expect(args).toEqual(['usage', '--details', '--start', '2026-11-17T23:00:00.000Z', '--end', '2026-11-18T23:00:00.000Z']);
    expect(r.models).toHaveLength(4);
  });

  it('fails on empty output or an error instead of a report', async () => {
    await expect(readAmpUsage('a', 'b', async () => '')).rejects.toThrow('printed nothing');
    await expect(readAmpUsage('a', 'b', async () => 'Error: --start and --end must be provided together\n')).rejects.toThrow('--start and --end');
  });
});
