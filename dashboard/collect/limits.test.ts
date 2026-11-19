import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeLimits, codexLimits, readClaudeLimits, toIso, windowLabel } from './limits.ts';
import { latestCodexLimits } from './codex.ts';

describe('limits', () => {
  it('names windows and reads times in seconds, milliseconds or ISO', () => {
    expect([300, 10_080, 43_200, 120, 45, null].map(windowLabel)).toEqual(['5 h', 'week', '30 d', '2 h', '45 min', 'window']);
    expect(toIso(1794333435)).toBe('2026-11-10T17:57:15.000Z');
    expect(toIso(1794333435000)).toBe('2026-11-10T17:57:15.000Z');
    expect(toIso('2026-11-10T19:57:15Z')).toBe('2026-11-10T19:57:15.000Z');
    expect(toIso(undefined)).toBeNull();
  });

  it('reads Codex rate_limits: primary and secondary window, plan', () => {
    const l = codexLimits({ plan_type: 'plus', primary: { used_percent: 2, window_minutes: 300, resets_at: 1794333435 }, secondary: { used_percent: 6, window_minutes: 10080, resets_at: 1794558272 } }, '2026-11-10T14:08:07Z');
    expect(l).toMatchObject({ app: 'codex', plan: 'plus', windows: [{ label: '5 h', usedPercent: 2 }, { label: 'week', usedPercent: 6 }] });
    expect(codexLimits({ primary: null, secondary: null }, 'x')).toBeNull();
  });

  it('reads Claude Code rate_limits loosely', () => {
    const l = claudeLimits({ five_hour: { used_percentage: 42, resets_at: 1795600000 }, seven_day: { used_percent: '17', resets_at: '2026-11-30T00:00:00Z' } }, '2026-11-19T10:00:00Z');
    expect(l?.windows.map((w) => [w.label, w.usedPercent, w.resetsAt])).toEqual([
      ['5 h', 42, '2026-11-25T09:46:40.000Z'],
      ['week', 17, '2026-11-30T00:00:00.000Z'],
    ]);
    expect(claudeLimits({}, 'x')).toBeNull();
  });

  it('takes the last readable line of the status line log', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'limits-')), 'claude-limits.jsonl');
    writeFileSync(file, [
      JSON.stringify({ at: '2026-11-19T09:00:00Z', rate_limits: { five_hour: { used_percentage: 10 } } }),
      JSON.stringify({ at: '2026-11-19T10:00:00Z', rate_limits: { five_hour: { used_percentage: 20 } } }),
      'broken',
    ].join('\n'));
    expect(readClaudeLimits(file)?.windows[0].usedPercent).toBe(20);
    expect(readClaudeLimits(join(tmpdir(), 'missing.jsonl'))).toBeNull();
  });

  it('keeps the latest Codex limits of a session file', () => {
    const tc = (ts: string, used: number) => JSON.stringify({ type: 'event_msg', timestamp: ts, payload: { type: 'token_count', rate_limits: { primary: { used_percent: used, window_minutes: 300 } } } });
    expect(latestCodexLimits([tc('2026-11-10T10:00:00Z', 5), tc('2026-11-10T12:00:00Z', 9), tc('2026-11-10T11:00:00Z', 7)])?.windows[0].usedPercent).toBe(9);
  });
});
