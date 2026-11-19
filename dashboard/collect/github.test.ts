import { describe, expect, it } from 'vitest';
import { githubSlug, mapLimit, parsePulls, readPulls, summarizeChecks } from './github.ts';

describe('github slug', () => {
  it('reads owner/name from GitHub remotes only', () => {
    expect(githubSlug('https://github.com/someone/my-site')).toBe('someone/my-site');
    expect(githubSlug('git@github.com:someone/fleet.git')).toBe('someone/fleet');
    expect(githubSlug('https://gitlab.com/o/r')).toBeNull();
  });
});

describe('checks', () => {
  it('counts check runs and commit statuses', () => {
    expect(summarizeChecks([
      { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' },
      { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' },
      { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' },
      { __typename: 'StatusContext', state: 'SUCCESS' },
      { __typename: 'StatusContext', state: 'PENDING' },
      { __typename: 'StatusContext', state: 'ERROR' },
    ])).toEqual({ passed: 3, failed: 2, pending: 2 });
    expect(summarizeChecks(null)).toEqual({ passed: 0, failed: 0, pending: 0 });
  });
});

describe('pull requests', () => {
  const all = [
    { number: 7, title: 'Draft', url: 'u7', headRefName: 'wip', state: 'OPEN', isDraft: true, author: { login: 'alex' }, createdAt: '2026-11-17T10:00:00Z', mergedAt: null, closedAt: null },
    { number: 9, title: 'Feature', url: 'u9', headRefName: 'feat/x', state: 'OPEN', isDraft: false, author: { login: 'alex' }, createdAt: '2026-11-18T10:00:00Z', mergedAt: null, closedAt: null },
    { number: 5, title: 'Done', url: 'u5', headRefName: 'fix/y', state: 'MERGED', isDraft: false, author: null, createdAt: '2026-11-01T10:00:00Z', mergedAt: '2026-11-02T10:00:00Z', closedAt: '2026-11-02T10:00:00Z' },
  ];
  const open = [{ number: 9, reviewDecision: 'APPROVED', statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }] }, { number: 7, reviewDecision: '', statusCheckRollup: [] }];

  it('merges both lists, newest first, with state, review and checks', () => {
    const prs = parsePulls(all, open);
    expect(prs.map((p) => [p.number, p.state, p.review, p.checks?.passed, p.endedAt])).toEqual([
      [9, 'open', 'approved', 1, null],
      [7, 'draft', null, 0, null],
      [5, 'merged', undefined, undefined, '2026-11-02T10:00:00Z'],
    ]);
  });

  it('runs gh with the repo and reports its errors per repo', async () => {
    const calls: string[][] = [];
    const ok = await readPulls('o/r', async (args) => {
      calls.push(args);
      return JSON.stringify(args.includes('all') ? all : open);
    });
    expect(ok.pulls).toHaveLength(3);
    expect(calls.every((a) => a.includes('--repo') && a.includes('o/r'))).toBe(true);

    const failed = await readPulls('o/r', async () => {
      throw Object.assign(new Error('exit 4'), { stderr: 'To get started with GitHub CLI, please run:  gh auth login\n...' });
    });
    expect(failed).toEqual({ slug: 'o/r', pulls: [], error: 'gh is not signed in (gh auth login)' });
  });
});

describe('mapLimit', () => {
  it('keeps order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2, 4], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20, 40]);
    expect(peak).toBe(2);
  });
});

describe('issues and alerts', async () => {
  const { parseAlerts, parseIssues, readAlerts, readIssues, readRepoGithub } = await import('./github.ts');

  it('reads issues with labels and assignees, latest update first', () => {
    const issues = parseIssues([
      { number: 1, title: 'Old', url: 'u1', labels: [{ name: 'bug' }], assignees: [], author: { login: 'a' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' },
      { number: 2, title: 'New', url: 'u2', labels: [], assignees: [{ login: 'someone' }], author: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z' },
    ]);
    expect(issues.map((i) => [i.number, i.labels, i.assignees])).toEqual([[2, [], ['someone']], [1, ['bug'], []]]);
  });

  it('reads Dependabot alerts, most severe first', () => {
    const alert = (number: number, severity: string, created: string) => ({
      number, state: 'open', html_url: `a${number}`, created_at: created,
      dependency: { package: { name: `pkg${number}`, ecosystem: 'npm' } },
      security_advisory: { summary: `Issue ${number}`, severity },
      security_vulnerability: { severity, first_patched_version: number === 2 ? null : { identifier: '1.2.3' } },
    });
    const withdrawn = { ...alert(5, 'high', '2026-11-04'), security_advisory: { summary: 'Withdrawn Advisory: x', severity: 'high', withdrawn_at: '2026-11-05T00:00:00Z' } };
    const alerts = parseAlerts([alert(1, 'low', '2026-11-01'), alert(2, 'critical', '2026-10-01'), alert(3, 'high', '2026-11-02'), { ...alert(4, 'high', '2026-11-03'), state: 'fixed' }, withdrawn]);
    expect(alerts.map((a) => [a.number, a.severity, a.package, a.fixedIn])).toEqual([[2, 'critical', 'pkg2', null], [3, 'high', 'pkg3', '1.2.3'], [1, 'low', 'pkg1', '1.2.3']]);
  });

  it('reads every page of alerts', async () => {
    const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ number: from + i, state: 'open', created_at: '2026-11-01', security_vulnerability: { severity: 'high' } }));
    let args: string[] = [];
    const r = await readAlerts('o/r', async (a) => { args = a; return JSON.stringify([page(1, 100), page(101, 30)]); });
    expect(args).toContain('--paginate');
    expect(args).toContain('--slurp');
    expect(r.alerts).toHaveLength(130);
    expect(parseAlerts(page(1, 3))).toHaveLength(3);
  });

  it('names a repo with issues turned off', async () => {
    const r = await readIssues('o/r', async () => { throw Object.assign(new Error('exit 1'), { stderr: "the 'o/r' repository has disabled issues" }); });
    expect(r).toEqual({ issuesError: 'issues are off for this repo' });
  });

  it('names why alerts could not be read', async () => {
    const off = await readAlerts('o/r', async () => { throw Object.assign(new Error('exit 1'), { stderr: 'gh: Dependabot alerts are disabled for this repository. (HTTP 403)' }); });
    expect(off).toEqual({ alertsError: 'Dependabot alerts are off for this repo' });
    const scope = await readAlerts('o/r', async () => { throw Object.assign(new Error('exit 1'), { stderr: 'gh: Resource not accessible by integration (HTTP 403)' }); });
    expect(scope.alertsError).toMatch(/no permission/);
  });

  it('combines pulls, issues and alerts of a repo', async () => {
    const r = await readRepoGithub('o/r', async (args) => (args[0] === 'api' ? '[]' : args[0] === 'issue' ? '[]' : '[]'));
    expect(r).toEqual({ slug: 'o/r', pulls: [], issues: [], alerts: [] });
  });
});
