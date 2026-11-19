import { describe, expect, it } from 'vitest';
import type { HostConfig, Repo } from '../../scripts/config.ts';
import { collectClaudeLines, parseClaudeLine, type UsageEvent } from './claude.ts';
import { costOf, priceOf, type PriceTable } from './pricing.ts';
import { normalizeRemote, repoMatcher } from './repo-map.ts';
import { mergeRows, rollup, type StatsRow } from './rollup.ts';
import { formatStats } from './stats.ts';

// A log line as Claude Code writes it (only the fields the reader uses, plus noise)
const line = (o: { id?: string; req?: string; out?: number; model?: string; split?: boolean; session?: string; ts?: string; cwd?: string; entry?: string } = {}) =>
  JSON.stringify({
    type: 'assistant',
    parentUuid: 'x',
    entrypoint: o.entry ?? 'claude-desktop',
    sessionId: o.session ?? 's1',
    timestamp: o.ts ?? '2026-11-18T10:00:00.000Z',
    cwd: o.cwd ?? '/repos/AI/my-site',
    gitBranch: 'main',
    requestId: o.req ?? 'req_1',
    message: {
      id: o.id ?? 'msg_1',
      model: o.model ?? 'claude-opus-5-5',
      content: [{ type: 'text', text: 'not read' }],
      usage: {
        input_tokens: 2,
        output_tokens: o.out ?? 100,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 500,
        ...(o.split === false ? {} : { cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 300 } }),
      },
    },
  });

describe('Claude Code reader', () => {
  it('reads the usage of an assistant reply', () => {
    const p = parseClaudeLine(line())!;
    expect(p.event).toMatchObject({ app: 'claude-code', client: 'claude-desktop', model: 'claude-opus-5-5', input: 2, output: 100, cacheRead: 1000, cacheWrite5m: 200, cacheWrite1h: 300, branch: 'main' });
  });

  it('counts unsplit cache writes as 5-minute writes', () => {
    expect(parseClaudeLine(line({ split: false }))!.event).toMatchObject({ cacheWrite5m: 500, cacheWrite1h: 0 });
  });

  it('skips other lines, broken JSON and synthetic replies', () => {
    expect(parseClaudeLine('{"type":"user","message":{"content":"hi"}}')).toBeNull();
    expect(parseClaudeLine('{"usage": oops')).toBeNull();
    expect(parseClaudeLine(line({ model: '<synthetic>' }))).toBeNull();
  });

  it('merges copies of one reply, keeping the highest output (streamed copies grow)', () => {
    const into = new Map<string, UsageEvent>();
    collectClaudeLines([line({ out: 16 }), line({ out: 301 }), line({ out: 16 })], into);
    collectClaudeLines([line({ out: 16 })], into); // the same reply in a resumed session's file
    collectClaudeLines([line({ id: 'msg_2', out: 5 })], into);
    expect([...into.values()].map((e) => e.output)).toEqual([301, 5]);
  });
});

describe('repo mapping', () => {
  const host: HostConfig = { root: '/repos', host: 'studio', flat: false, amp: false, collectMinutes: 15, data: null };
  const repos: Repo[] = [
    { name: 'my-site', description: 'x.', remote: 'https://github.com/someone/my-site', dir: 'AI', formerNames: ['old-site'] },
    { name: 'my-plugin', description: 'x.', remote: 'https://github.com/someone/my-plugin', dir: 'Sideprojects', worktrees: ['2.x'] },
  ];
  const remotes: Record<string, string> = {
    '/fleet': 'git@github.com:someone/fleet.git',
    '/elsewhere/.delta/worktrees/abc/my-site': 'git@github.com:SomeOne/my-site.git',
  };
  const match = repoMatcher(repos, host, '/fleet', (cwd) => remotes[cwd] ?? null);

  it('normalizes remotes', () => {
    expect(normalizeRemote('git@github.com:o/r.git')).toBe('github.com/o/r');
    expect(normalizeRemote('https://user@GitHub.com/o/r/')).toBe('github.com/o/r');
    expect(normalizeRemote('ssh://git@github.com/o/r.git')).toBe('github.com/o/r');
  });

  it('matches by remote first, wherever the checkout lives', () => {
    expect(match('/elsewhere/.delta/worktrees/abc/my-site')).toBe('my-site');
  });

  it('falls back to the path: repo, subfolder, worktree, fleet', () => {
    expect(match('/repos/AI/my-site')).toBe('my-site');
    expect(match('/repos/AI/my-site/src')).toBe('my-site');
    expect(match('/repos/Sideprojects/my-plugin-2.x')).toBe('my-plugin');
    expect(match('/fleet/dashboard')).toBe('fleet');
  });

  it('reads the repo from the folder of a worktree that is gone', () => {
    expect(match('/home/.t3/worktrees/my-site/t3code-4b7c86f7')).toBe('my-site');
    expect(match('/home/.herdr/worktrees/my-plugin/wt-stylex/src')).toBe('my-plugin');
    expect(match('/home/.t3/worktrees/old-site/t3-1')).toBe('my-site');
    expect(match('/home/.t3/worktrees/stylex/t3-1')).toBe('other');
    expect(match('/home/Dropbox/my-site')).toBe('other');
  });

  it('counts an earlier name of a repo: remote at the same owner, and its old folder', () => {
    const renamed = repoMatcher(repos, host, '/fleet', (cwd) => (cwd === '/somewhere/old-site copy' ? 'https://someone@github.com/someone/old-site' : null));
    expect(renamed('/somewhere/old-site copy')).toBe('my-site');
    expect(renamed('/repos/AI/old-site/src')).toBe('my-site');
  });

  it('does not confuse a prefix of a name with the repo', () => {
    expect(match('/repos/AI/my-site-old')).toBe('other');
    expect(match('/repos/AI')).toBe('other');
  });

  it('follows a flat host', () => {
    const flat = repoMatcher(repos, { ...host, flat: true }, '/fleet', () => null);
    expect(flat('/repos/my-site')).toBe('my-site');
    expect(flat('/repos/my-plugin-2.x')).toBe('my-plugin');
  });
});

describe('pricing', () => {
  const table: PriceTable = {
    'claude-opus-5-5': { input_cost_per_token: 4e-6, output_cost_per_token: 2e-5, cache_read_input_token_cost: 2e-7, cache_creation_input_token_cost: 5e-6, cache_creation_input_token_cost_above_1hr: 8e-6 },
    'anthropic/claude-x': { input_cost_per_token: 1e-6 },
  };

  it('prices every kind of token', () => {
    const p = priceOf('claude-opus-5-5', table)!;
    const cost = costOf({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite5m: 1_000_000, cacheWrite1h: 1_000_000 }, p);
    expect(cost).toBeCloseTo(4 + 20 + 0.2 + 5 + 8, 6);
  });

  it('finds prefixed names and falls back for missing cache prices', () => {
    expect(priceOf('claude-x', table)).toEqual({ input: 1e-6, output: 0, cacheRead: 1e-6, cacheWrite5m: 1e-6, cacheWrite1h: 1e-6 });
    expect(priceOf('unknown', table)).toBeNull();
  });
});

describe('rollup and merge', () => {
  const ctx = {
    host: 'studio',
    dayOf: (ts: string) => ts.slice(0, 10),
    repoOf: () => 'my-site',
    priceOf: (model: string) => (model === 'priced' ? { input: 1, output: 1, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } : null),
  };
  const ev = (o: Partial<UsageEvent>): UsageEvent => ({
    app: 'claude-code', client: 'cli', sessionId: 's1', timestamp: '2026-11-18T10:00:00Z', cwd: '/x', branch: 'main', model: 'priced',
    input: 1, output: 2, cacheRead: 0, cacheWrite5m: 3, cacheWrite1h: 4, ...o,
  });

  it('sums per day and group, counts distinct sessions, prices on the way', () => {
    const rows = rollup([ev({}), ev({ sessionId: 's2' }), ev({ sessionId: 's2' }), ev({ timestamp: '2026-11-17T10:00:00Z' })], ctx);
    expect(rows.map((r) => [r.day, r.sessions, r.input, r.output, r.cacheWrite, r.cost])).toEqual([
      ['2026-11-17', 1, 1, 2, 7, 3],
      ['2026-11-18', 2, 3, 6, 21, 9],
    ]);
  });

  it('leaves the cost empty when a model has no price', () => {
    expect(rollup([ev({ model: 'mystery' })], ctx)[0].cost).toBeNull();
  });

  const row = (day: string, input: number, app = 'claude-code'): StatsRow => ({
    day, host: 'studio', app, client: 'cli', repo: 'my-site', branch: 'main', model: 'm', sessions: 1, input, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0,
  });

  it('replaces recent days, keeps older ones, fills older gaps, leaves other apps alone', () => {
    const stored = [row('2026-10-01', 100), row('2026-11-10', 100), row('2026-11-10', 7, 'codex')];
    const fresh = [row('2026-10-01', 1), row('2026-10-02', 1), row('2026-11-10', 1), row('2026-11-11', 1)];
    const merged = mergeRows(stored, fresh, 'claude-code', '2026-11-01');
    expect(merged.map((r) => [r.day, r.app, r.input])).toEqual([
      ['2026-10-01', 'claude-code', 100], // older, stored: kept although the logs say less
      ['2026-10-02', 'claude-code', 1], // older gap: filled
      ['2026-11-10', 'claude-code', 1], // recent: recomputed
      ['2026-11-10', 'codex', 7], // other app: untouched
      ['2026-11-11', 'claude-code', 1],
    ]);
  });

  it('writes one row per line', () => {
    const text = formatStats({ host: 'studio', month: '2026-11', rows: [row('2026-11-10', 1), row('2026-11-11', 2)] });
    expect(text.split('\n').filter((l) => l.startsWith('    {'))).toHaveLength(2);
    expect(JSON.parse(text).rows).toHaveLength(2);
    expect(formatStats({ host: 'studio', month: '2026-11', rows: [] })).toContain('"rows": []');
  });
});
