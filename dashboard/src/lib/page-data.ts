/**
 * What every usage page needs from a request: the period from the URL, its days, and the stats rows
 * of it and of the previous period. Read on the server on every request, so a reload shows what
 * the collector wrote last.
 */
import { join } from 'node:path';
import { fleetPaths } from '../../../scripts/config.ts';
import { hostConfig } from './fleet.ts';
import { readAllCommits, readAllPrefixed, readAllStats } from '../../collect/stats.ts';
import type { AmpThreadRow } from '../../collect/amp.ts';
import type { CommitRow, GoneBranch, Uncommitted } from '../../collect/commits.ts';
import { readClaudeLimits, type PlanLimits } from '../../collect/limits.ts';
import type { SiteCheck } from '../../collect/sites.ts';
import { readSnapshot } from '../../collect/snapshot.ts';
import type { RepoGithub } from '../../collect/github.ts';
import { localDay, parsePeriod, periodRange, type Day, type Period, type PeriodRange } from './period.ts';
import { firstDay, rowsIn, type StatsRow } from './usage.ts';

export interface UsageContext {
  period: Period;
  today: Day;
  range: PeriodRange;
  /** Every stored row, all hosts. */
  all: StatsRow[];
  /** Rows of the period. */
  rows: StatsRow[];
  /** Rows of the previous period; null for all. */
  previous: StatsRow[] | null;
}

/** The usage data on this host: the data repo (fleet.local.json `data`), or stats/ in fleet without one. */
const statsDir = () => fleetPaths(__FLEET_DIR__, hostConfig()).usage;

export function usageContext(url: URL): UsageContext {
  const period = parsePeriod(url.searchParams.get('period'));
  const today = localDay(new Date());
  const all = readAllStats(statsDir());
  const range = periodRange(period, today, firstDay(all));
  return {
    period,
    today,
    range,
    all,
    rows: rowsIn(all, range),
    previous: range.previous ? rowsIn(all, range.previous) : null,
  };
}

export interface GithubData {
  /** When the collector last read GitHub; null when it never did. */
  at: string | null;
  /** Pull requests, issues and alerts per repo name. */
  repos: Record<string, RepoGithub>;
  /** The signed-in GitHub user, for "assigned to you". */
  viewer: string | null;
}

/** What the collector last read from GitHub (.cache/snapshot.json). */
export function githubData(): GithubData {
  const s = readSnapshot(join(__FLEET_DIR__, '.cache', 'snapshot.json'));
  return { at: s.githubAt ?? null, repos: s.github ?? {}, viewer: s.githubViewer ?? null };
}

export interface CommitData {
  /** Estimated cost per commit, every host. */
  commits: CommitRow[];
  /** From the last collector run on this host. */
  uncommitted: Uncommitted[];
  goneBranches: GoneBranch[];
}

/** Commit estimates (stats/<host>/commits-*.json) and the work no commit took (.cache/snapshot.json). */
export function commitData(): CommitData {
  const s = readSnapshot(join(__FLEET_DIR__, '.cache', 'snapshot.json'));
  return { commits: readAllCommits<CommitRow>(statsDir()), uncommitted: s.uncommitted ?? [], goneBranches: s.goneBranches ?? [] };
}

/** Plan limits: Claude Code's live from the status line log, Codex's from the last collector run. */
export function limitsData(): { claude: PlanLimits | null; codex: PlanLimits | null; amp: PlanLimits | null } {
  const s = readSnapshot(join(__FLEET_DIR__, '.cache', 'snapshot.json'));
  return { claude: readClaudeLimits(join(__FLEET_DIR__, '.cache', 'claude-limits.jsonl')), codex: s.codexLimits ?? null, amp: s.ampLimits ?? null };
}

/** Site checks from the last collector run. */
export function sitesData(): { checks: SiteCheck[]; at: string | null } {
  const s = readSnapshot(join(__FLEET_DIR__, '.cache', 'snapshot.json'));
  return { checks: s.sites ?? [], at: s.sitesAt ?? null };
}

/** Amp usage per thread and day (stats/<host>/amp-threads-*.json), and the last read. */
export function ampData(): { threads: AmpThreadRow[]; at: string | null; error: string | null } {
  const s = readSnapshot(join(__FLEET_DIR__, '.cache', 'snapshot.json'));
  return { threads: readAllPrefixed<AmpThreadRow>(statsDir(), 'amp-threads'), at: s.ampAt ?? null, error: s.ampError ?? null };
}
