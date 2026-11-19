/**
 * The collector: reads the local session logs, rolls them up per day and writes <data>/<host>/;
 * estimates the cost per commit (<data>/<host>/commits-*.json); reads the pull requests through gh
 * into .cache/snapshot.json. <data> is the private data repo (fleet.local.json `data`, next to the
 * repos), which also holds fleet.json: pulled before a run, so the repo list and the other hosts'
 * data are fresh, and this host's folder committed and pushed after it. Rewrites REPOS.md when the
 * list changed.
 *
 *   node dashboard/collect/index.ts             collect and write
 *   node dashboard/collect/index.ts --dry-run   collect and report, write nothing
 *   node dashboard/collect/index.ts --no-gh     skip GitHub; the last snapshot stays
 *   node dashboard/collect/index.ts --offline   skip everything that needs the network (GitHub, sites, Amp, sync)
 *   node dashboard/collect/index.ts --no-sync   neither pull nor push the data repo
 *
 * Runs on Node's type stripping (22.18+). Readers: Claude Code, Codex, Pi, gh; git is read live by
 * the pages.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fleetPaths, loadHostConfig, loadRepos, repoDir, writeRepoList } from '../../scripts/config.ts';
import { addDays, localDay } from '../src/lib/period.ts';
import { CLAUDE_APP, claudeDir, claudeRetentionDays, readClaudeLogs, type UsageEvent } from './claude.ts';
import { CODEX_APP, readCodexLogs } from './codex.ts';
import { PI_APP, readPiLogs } from './pi.ts';
import { assign, branchLog, mergeCommitRows, type CommitRow, type GoneBranch, type PricedEvent, type Uncommitted } from './commits.ts';
import { costOf, loadPrices, priceOf } from './pricing.ts';
import { githubSlug, mapLimit, readRepoGithub, viewerLogin, type RepoGithub } from './github.ts';
import { FLEET, gitRemote, repoMatcher } from './repo-map.ts';
import { mergeRows, rollup, sortRows, type StatsRow } from './rollup.ts';
import { checkSite, type SiteCheck } from './sites.ts';
import { AMP_APP, ampDaysToRead, ampRows, ampThreadRows, mergeAmpRows, readAmpUsage, type AmpThreadRow } from './amp.ts';
import { readSnapshot, writeSnapshot } from './snapshot.ts';
import { acquireLock, lockHolder } from './lock.ts';
import { cannotSync, gitIn, pullData, pushData, type GitRun } from './sync.ts';
import { readAllStats, readCommits, readPrefixed, readStats, writeCommits, writePrefixed, writeStats } from './stats.ts';

const FLEET_DIR = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const dryRun = process.argv.includes('--dry-run');
const offline = process.argv.includes('--offline');
const noGh = offline || process.argv.includes('--no-gh');
const noSync = offline || dryRun || process.argv.includes('--no-sync');

// The report: printed, and kept for .cache/last-collect.json (shown by the dashboard)
const report: string[] = [];
const say = (line: string) => {
  report.push(line);
  console.log(line);
};
const LAST_COLLECT = fileURLToPath(new URL('../../.cache/last-collect.json', import.meta.url));
const writeLast = (ok: boolean, error?: string) => {
  if (dryRun) return;
  mkdirSync(dirname(LAST_COLLECT), { recursive: true });
  writeFileSync(LAST_COLLECT, `${JSON.stringify({ at: new Date().toISOString(), ok, ...(error ? { error } : {}), report }, null, 2)}\n`);
};

const fmt = (n: number) => Math.round(n).toLocaleString('en-GB');
const usd = (n: number) => `$${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function main() {
  const localFile = join(FLEET_DIR, 'fleet.local.json');
  if (!existsSync(localFile)) throw new Error('fleet.local.json is missing: run scripts/setup.sh on this host first');
  const host = loadHostConfig(localFile);
  const paths = fleetPaths(FLEET_DIR, host);
  const statsDir = paths.usage;
  const dataLabel = basename(statsDir);

  // The data repo: fetch the repo list and what the other hosts pushed before reading anything
  let sync: GitRun | null = null;
  let syncNote: string;
  if (!paths.data) syncNote = 'fleet.json and stats/ in fleet, this host only (no "data" in fleet.local.json)';
  else if (!existsSync(paths.data)) throw new Error(`the data repo is missing at ${paths.data}: run scripts/setup.sh`);
  else if (noSync) syncNote = `${dataLabel} not synced (${offline ? '--offline' : dryRun ? '--dry-run' : '--no-sync'})`;
  else {
    const git = gitIn(paths.data);
    const why = cannotSync(git);
    if (why) syncNote = `${dataLabel} not synced: ${why}`;
    else {
      sync = git;
      syncNote = `${dataLabel} ${pullData(git)}`;
    }
  }
  if (!existsSync(paths.list)) throw new Error(`no repo list at ${paths.list}: run scripts/setup.sh, or start one from fleet.example.json`);
  const repos = loadRepos(paths.list);
  if (!dryRun && writeRepoList(paths.repoList, repos) === 'written') say('REPOS.md: rewritten from fleet.json');

  const { table, source, error: priceError } = await loadPrices({
    cacheFile: join(FLEET_DIR, '.cache', 'litellm-prices.json'),
    overridesFile: join(FLEET_DIR, 'pricing.overrides.json'),
  });

  const today = localDay(new Date());
  const dayOf = (ts: string) => localDay(new Date(ts));
  const repoOf = repoMatcher(repos, host, FLEET_DIR);
  const firstDayOf = (events: UsageEvent[]) => events.reduce<string | null>((m, e) => { const d = dayOf(e.timestamp); return m === null || d < m ? d : m; }, null);

  // Every app's events, and from which day its logs still hold every session. Claude Code deletes
  // whole transcripts after its retention, so every day after (today − retention) is complete, with
  // one day of margin. Codex and Pi keep their logs; their first day may be partial, so one day later.
  const dir = claudeDir();
  const claude = readClaudeLogs(dir);
  const codex = readCodexLogs();
  const pi = readPiLogs();
  const later = (events: UsageEvent[]) => { const d = firstDayOf(events); return d ? addDays(d, 1) : today; };
  const apps = [
    { app: CLAUDE_APP, ...claude, recomputeFrom: addDays(today, -(claudeRetentionDays(dir) - 2)) },
    { app: CODEX_APP, ...codex, recomputeFrom: later(codex.events) },
    { app: PI_APP, ...pi, recomputeFrom: later(pi.events) },
  ];
  const recomputeFrom = apps[0].recomputeFrom;
  const events = apps.flatMap((a) => a.events);
  const fresh = rollup(events, {
    host: host.host,
    dayOf,
    repoOf,
    priceOf: (model) => priceOf(model, table),
  });

  // Amp: per account, so only on the host with "amp": true. One `amp usage` call per local day:
  // today, yesterday, then missing older days (oldest first); at most every 15 minutes, as the CLI
  // allows 60 lookups an hour.
  const snapshotFile = join(FLEET_DIR, '.cache', 'snapshot.json');
  let ampNote = !host.amp ? 'off (set "amp": true in fleet.local.json on one host)' : offline ? 'skipped (--offline)' : '';
  const ampStats: StatsRow[] = [];
  const ampThreads: AmpThreadRow[] = [];
  const ampRead = new Set<string>();
  if (host.amp && !offline) {
    const snap = readSnapshot(snapshotFile);
    const minutesAgo = snap.ampAt ? (Date.now() - Date.parse(snap.ampAt)) / 60_000 : Infinity;
    if (minutesAgo < 15) ampNote = `skipped, last read ${Math.round(minutesAgo)} min ago`;
    else {
      const known = new Set([...readAllStats(statsDir).filter((r) => r.app === AMP_APP && r.host === host.host).map((r) => r.day), ...(snap.ampEmptyDays ?? [])]);
      const days = ampDaysToRead(today, known, 10, addDays);
      const empty = new Set(snap.ampEmptyDays ?? []);
      let limits = snap.ampLimits ?? null;
      let error: string | null = null;
      for (const day of days) {
        const [y, m, d] = day.split('-').map(Number);
        const start = new Date(y, m - 1, d).toISOString();
        const end = day === today ? new Date().toISOString() : new Date(y, m - 1, d + 1).toISOString();
        try {
          const report = await readAmpUsage(start, end);
          if (report.limits) limits = report.limits;
          const rows = ampRows(report, { day, host: host.host, priceOf: (model) => priceOf(model, table) });
          ampStats.push(...rows);
          ampThreads.push(...ampThreadRows(report, { day, host: host.host }));
          ampRead.add(day);
          if (rows.length === 0 && day < addDays(today, -1)) empty.add(day);
        } catch (err) {
          error = (err as Error).message;
          break;
        }
      }
      ampNote = `${days.length} days read${error ? `, stopped: ${error}` : ''}`;
      if (!dryRun) writeSnapshot(snapshotFile, { ampAt: new Date().toISOString(), ampLimits: limits, ampError: error, ampEmptyDays: [...empty].sort() });
    }
  }

  // Merge month by month, app by app
  const months = new Map<string, StatsRow[]>();
  for (const row of [...fresh, ...ampStats]) {
    const m = row.day.slice(0, 7);
    if (!months.has(m)) months.set(m, []);
    months.get(m)!.push(row);
  }
  const changed: string[] = [];
  for (const [month, rows] of [...months].sort()) {
    let merged = readStats(statsDir, host.host, month);
    for (const a of apps) merged = mergeRows(merged, rows, a.app, a.recomputeFrom);
    // Amp: days read in this run; today and yesterday replaced, older days only filled when missing
    merged = sortRows(mergeAmpRows(merged, rows, ampRead, addDays(today, -1)));
    if (!dryRun && writeStats(statsDir, { host: host.host, month, rows: merged })) changed.push(month);
  }

  // Amp threads per day: today and yesterday replaced, older days kept unless missing
  const changedThreads: string[] = [];
  for (const month of [...new Set([...ampRead].map((d) => d.slice(0, 7)))].sort()) {
    const stored = readPrefixed<AmpThreadRow>(statsDir, host.host, 'amp-threads', month);
    const rows = mergeAmpRows(stored, ampThreads.filter((t) => t.day.startsWith(month)), ampRead, addDays(today, -1), () => true)
      .sort((a, b) => a.day.localeCompare(b.day) || b.tokens - a.tokens || a.thread.localeCompare(b.thread));
    if (rows.length === 0) continue;
    if (!dryRun && writePrefixed(statsDir, 'amp-threads', { host: host.host, month, rows })) changedThreads.push(month);
  }

  // Cost per commit (estimate): every reply on a branch goes to the next commit there
  const checkouts = new Map<string, string>([[FLEET, FLEET_DIR]]);
  for (const r of repos) {
    const d = repoDir(r, host);
    if (existsSync(d)) checkouts.set(r.name, d);
  }
  const byBranch = new Map<string, PricedEvent[]>();
  for (const e of events) {
    const repo = repoOf(e.cwd);
    if (!checkouts.has(repo) || !e.branch || e.branch === 'HEAD') continue;
    const price = e.loggedCost === undefined ? priceOf(e.model, table) : null;
    const key = `${repo}:${e.branch}`;
    const list = byBranch.get(key) ?? [];
    list.push({ ...e, repo, cost: e.loggedCost ?? (price ? costOf(e, price) : null) });
    byBranch.set(key, list);
  }
  const groups = [...byBranch].map(([key, list]) => ({ key, repo: list[0].repo, branch: list[0].branch!, list }));
  const logs = await mapLimit(groups, 8, (g) => branchLog(checkouts.get(g.repo)!, g.branch, g.list.reduce((m, e) => (e.timestamp < m ? e.timestamp : m), g.list[0].timestamp)));
  const commitRows: CommitRow[] = [];
  const uncommitted: Uncommitted[] = [];
  const goneBranches: GoneBranch[] = [];
  const computed = new Set<string>();
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  groups.forEach((g, i) => {
    const log = logs[i];
    if (!log) {
      const lastAt = g.list.reduce((m, e) => (e.timestamp > m ? e.timestamp : m), g.list[0].timestamp);
      goneBranches.push({ repo: g.repo, branch: g.branch, lastAt, cost: round(g.list.reduce((a, e) => a + (e.cost ?? 0), 0)) });
      return;
    }
    computed.add(g.key);
    const r = assign(g.list, log, { host: host.host, repo: g.repo, branch: g.branch, dayOf });
    commitRows.push(...r.rows);
    if (r.uncommitted) uncommitted.push(r.uncommitted);
  });
  // Months with fresh commits, and every month of the window (a rebase there drops stored commits)
  const commitMonths = new Set(commitRows.map((r) => r.day.slice(0, 7)));
  for (let d = recomputeFrom; d <= today; d = addDays(d, 28)) commitMonths.add(d.slice(0, 7));
  commitMonths.add(today.slice(0, 7));
  const changedCommits: string[] = [];
  for (const month of [...commitMonths].sort()) {
    const merged = mergeCommitRows(readCommits<CommitRow>(statsDir, host.host, month), commitRows.filter((r) => r.day.startsWith(month)), recomputeFrom, computed);
    if (!dryRun && merged.length && writeCommits(statsDir, { host: host.host, month, rows: merged })) changedCommits.push(month);
  }
  if (!dryRun) writeSnapshot(join(FLEET_DIR, '.cache', 'snapshot.json'), { uncommittedAt: new Date().toISOString(), uncommitted, goneBranches, codexLimits: codex.limits });

  // GitHub: pull requests of every repo on GitHub, fleet included, four repos at a time
  let github: Record<string, RepoGithub> | null = null;
  if (!noGh) {
    const targets = [...repos.map((r) => ({ name: r.name, remote: r.remote })), { name: FLEET, remote: gitRemote(FLEET_DIR) ?? '' }]
      .map((t) => ({ name: t.name, slug: githubSlug(t.remote) }))
      .filter((t): t is { name: string; slug: string } => t.slug !== null);
    const [results, viewer] = await Promise.all([mapLimit(targets, 4, (t) => readRepoGithub(t.slug)), viewerLogin()]);
    github = Object.fromEntries(targets.map((t, i) => [t.name, results[i]]));
    if (!dryRun) writeSnapshot(join(FLEET_DIR, '.cache', 'snapshot.json'), { githubAt: new Date().toISOString(), github, githubViewer: viewer });
  }

  // Sites: reachability and certificates, all at once (a handful)
  let sites: SiteCheck[] | null = null;
  if (!offline) {
    sites = await Promise.all(repos.filter((r) => r.site).map((r) => checkSite(r.name, r.site!)));
    if (!dryRun) writeSnapshot(join(FLEET_DIR, '.cache', 'snapshot.json'), { sitesAt: new Date().toISOString(), sites });
  }

  // Report
  const unpriced = [...new Set(fresh.filter((r) => r.cost === null).map((r) => r.model))];
  const sum = (rows: StatsRow[], f: (r: StatsRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const by = (field: 'repo' | 'client' | 'model' | 'app') => {
    const totals = new Map<string, number>();
    for (const r of fresh) totals.set(r[field], (totals.get(r[field]) ?? 0) + (r.cost ?? 0));
    return [...totals].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${usd(v)}`).join(', ');
  };
  const priceNote = priceError ? ` (LiteLLM not reached: ${priceError})` : '';
  say(`host ${host.host}; prices: ${source === 'fresh' ? 'fresh from LiteLLM' : source === 'cache' ? `cached${priceNote}` : `none, no cache${priceNote}`}`);
  for (const a of apps) {
    const appRows = fresh.filter((r) => r.app === a.app);
    const appDays = [...new Set(appRows.map((r) => r.day))].sort();
    say(`${a.app}: ${fmt(a.files)} log files, ${fmt(a.events.length)} replies, ${appDays.length ? `${appDays[0]} … ${appDays.at(-1)}` : 'no days'}, ${usd(sum(appRows, (r) => r.cost ?? 0))}; recomputed from ${a.recomputeFrom}`);
  }
  say(`all apps:`);
  say(`  tokens: ${fmt(sum(fresh, (r) => r.input))} in, ${fmt(sum(fresh, (r) => r.output))} out, ${fmt(sum(fresh, (r) => r.cacheRead))} cache read, ${fmt(sum(fresh, (r) => r.cacheWrite))} cache write`);
  say(`  cost: ${usd(sum(fresh, (r) => r.cost ?? 0))} at API list prices`);
  say(`  by app: ${by('app')}`);
  say(`  by repo: ${by('repo')}`);
  say(`  by client: ${by('client')}`);
  say(`  by model: ${by('model')}`);
  if (unpriced.length) say(`  no price for: ${unpriced.join(', ')}; add them to pricing.overrides.json`);
  const onCommits = commitRows.reduce((a, r) => a + (r.cost ?? 0), 0);
  const open = uncommitted.reduce((a, u) => a + u.cost, 0);
  const gone = goneBranches.reduce((a, b) => a + b.cost, 0);
  say(`commits: ${commitRows.length} commits on ${computed.size} branches got ${usd(onCommits)}; ${usd(open)} after the last commit on ${uncommitted.length} branches; ${usd(gone)} on ${goneBranches.length} branches git no longer has`);
  if (codex.limits) say(`codex limits (${codex.limits.plan ?? 'plan?'}, as of ${codex.limits.at.slice(0, 16)}): ${codex.limits.windows.map((w) => `${w.label} ${w.usedPercent} %`).join(', ')}`);
  if (github) {
    const list = Object.values(github);
    const errors = [...new Set(list.flatMap((g) => (g.error ? [g.error] : [])))];
    const open = list.flatMap((g) => g.pulls).filter((p) => p.state === 'open' || p.state === 'draft').length;
    const ok = list.filter((g) => !g.error).length;
    const issues = list.reduce((a, g) => a + (g.issues?.length ?? 0), 0);
    const alerts = list.reduce((a, g) => a + (g.alerts?.length ?? 0), 0);
    const alertsOff = list.filter((g) => g.alertsError).length;
    say(`github: ${ok} of ${list.length} repos read, ${open} open pull requests, ${issues} open issues, ${alerts} open Dependabot alerts${alertsOff ? ` (${alertsOff} repos without alerts: ${[...new Set(list.flatMap((g) => (g.alertsError ? [g.alertsError] : [])))].join('; ')})` : ''}${errors.length ? `; errors: ${errors.join('; ')}` : ''}`);
  } else say(`github: skipped (${offline ? '--offline' : '--no-gh'})`);
  say(`amp: ${ampNote}${ampStats.length ? `; ${ampStats.length} model rows, ${ampThreads.length} thread rows, ${usd(ampStats.reduce((a, r) => a + (r.cost ?? 0), 0))} at list prices` : ''}`);
  if (sites) {
    const down = sites.filter((x) => !x.ok);
    say(`sites: ${sites.length - down.length} of ${sites.length} up${down.length ? `; down: ${down.map((x) => `${x.url} (${x.error})`).join(', ')}` : ''}`);
  } else say('sites: skipped (--offline)');
  const written = [...changed, ...changedCommits.map((m) => `commits-${m}`), ...changedThreads.map((m) => `amp-threads-${m}`)];
  say(dryRun ? 'dry run: nothing written' : written.length ? `wrote ${dataLabel}/${host.host}/ ${written.join(', ')}` : 'stats unchanged');
  if (sync) syncNote += `, ${pushData(sync, host.host, new Date().toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }))}`;
  say(`data: ${syncNote}`);
}

// One collector at a time (dashboard background runs, its refresh button, pnpm collect)
const LOCK = fileURLToPath(new URL('../../.cache/collect.lock', import.meta.url));
const release = dryRun ? () => {} : acquireLock(LOCK);
if (!release) {
  console.log(`collect: another collector is running (pid ${lockHolder(LOCK)}); nothing done`);
} else main().then(() => writeLast(true)).catch((err) => {
  console.error(`collect: ${(err as Error).message}`);
  writeLast(false, (err as Error).message);
  process.exitCode = 1;
}).finally(release);
