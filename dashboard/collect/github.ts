/**
 * GitHub reader through the signed-in `gh` CLI (fleet never reads a token itself): per repo the pull
 * requests with review and CI state, the open issues, and the open Dependabot alerts. Needs the
 * network, so it runs in the collector and lands in .cache/snapshot.json, not on every page request.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeRemote } from './repo-map.ts';

const run = promisify(execFile);

export type PrState = 'open' | 'draft' | 'merged' | 'closed';
export type Review = 'approved' | 'changes-requested' | 'review-required' | null;

export interface Checks {
  passed: number;
  failed: number;
  pending: number;
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  /** Head branch: the key to its cost in the stats. */
  branch: string;
  state: PrState;
  author: string | null;
  createdAt: string;
  /** Merge or close time; null while open. */
  endedAt: string | null;
  /** Open PRs only. */
  review?: Review;
  checks?: Checks;
}

export interface Issue {
  number: number;
  title: string;
  url: string;
  labels: string[];
  assignees: string[];
  author: string | null;
  createdAt: string;
  updatedAt: string;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low'];

/** An open Dependabot alert. */
export interface Alert {
  number: number;
  severity: Severity;
  package: string;
  ecosystem: string;
  summary: string;
  /** First version without the vulnerability; null when there is none yet. */
  fixedIn: string | null;
  url: string;
  createdAt: string;
}

/** What the collector read from GitHub for one repo. */
export interface RepoGithub {
  /** owner/name on GitHub. */
  slug: string;
  pulls: PullRequest[];
  /** Why the pull requests could not be read; the list is then empty. */
  error?: string;
  issues?: Issue[];
  issuesError?: string;
  alerts?: Alert[];
  /** Why the alerts could not be read, e.g. Dependabot alerts are off for the repo. */
  alertsError?: string;
}

/** owner/name of a GitHub remote; null for other hosts. */
export function githubSlug(remote: string): string | null {
  const n = normalizeRemote(remote);
  const m = /^github\.com\/([^/]+\/[^/]+)$/.exec(n);
  return m ? m[1] : null;
}

const PASS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const FAIL_STATES = new Set(['FAILURE', 'ERROR']);

/** Summarizes gh's `statusCheckRollup` (check runs and commit statuses). */
export function summarizeChecks(rollup: unknown): Checks {
  const c: Checks = { passed: 0, failed: 0, pending: 0 };
  if (!Array.isArray(rollup)) return c;
  for (const item of rollup as Record<string, string>[]) {
    if (item.__typename === 'StatusContext' || ('state' in item && !('conclusion' in item))) {
      if (item.state === 'SUCCESS') c.passed++;
      else if (FAIL_STATES.has(item.state)) c.failed++;
      else c.pending++;
    } else if (item.status !== 'COMPLETED') c.pending++;
    else if (PASS.has(item.conclusion)) c.passed++;
    else c.failed++;
  }
  return c;
}

const REVIEW: Record<string, Review> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes-requested', REVIEW_REQUIRED: 'review-required' };

/** Merges gh's two lists: every recent PR, with review and checks from the open ones. */
export function parsePulls(all: unknown, open: unknown): PullRequest[] {
  const extra = new Map<number, Record<string, any>>();
  if (Array.isArray(open)) for (const o of open) extra.set(o.number, o);
  if (!Array.isArray(all)) return [];
  return all
    .map((p: Record<string, any>): PullRequest => {
      const state: PrState = p.state === 'MERGED' ? 'merged' : p.state === 'CLOSED' ? 'closed' : p.isDraft ? 'draft' : 'open';
      const o = extra.get(p.number);
      return {
        number: p.number,
        title: p.title ?? '',
        url: p.url ?? '',
        branch: p.headRefName ?? '',
        state,
        author: p.author?.login ?? null,
        createdAt: p.createdAt,
        endedAt: p.mergedAt || p.closedAt || null,
        ...(o ? { review: REVIEW[o.reviewDecision] ?? null, checks: summarizeChecks(o.statusCheckRollup) } : {}),
      };
    })
    .sort((a, b) => b.number - a.number);
}

export type GhRunner = (args: string[]) => Promise<string>;

const ghRunner: GhRunner = async (args) => (await run('gh', args, { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })).stdout;

/** gh's error in one line, without its help text. */
function ghError(err: unknown): string {
  const e = err as { code?: string; stderr?: string; message?: string };
  if (e.code === 'ENOENT') return 'gh is not installed';
  const text = (e.stderr || e.message || 'gh failed').trim();
  if (/auth login|not logged in|authentication|token .*invalid/i.test(text)) return 'gh is not signed in (gh auth login)';
  if (/dependabot alerts are disabled/i.test(text)) return 'Dependabot alerts are off for this repo';
  if (/has disabled issues/i.test(text)) return 'issues are off for this repo';
  if (/HTTP 403|must have admin|Resource not accessible/i.test(text)) return 'no permission (gh auth refresh -s security_events)';
  return text.split('\n')[0].slice(0, 200);
}

const ALL_FIELDS = 'number,title,url,headRefName,state,isDraft,author,createdAt,mergedAt,closedAt';
const OPEN_FIELDS = 'number,reviewDecision,statusCheckRollup';

/** Pull requests of one GitHub repo: the latest `limit` in any state, open ones with review and checks. */
export async function readPulls(slug: string, gh: GhRunner = ghRunner, limit = 60): Promise<RepoGithub> {
  try {
    const [all, open] = await Promise.all([
      gh(['pr', 'list', '--repo', slug, '--state', 'all', '--limit', String(limit), '--json', ALL_FIELDS]),
      gh(['pr', 'list', '--repo', slug, '--state', 'open', '--limit', '50', '--json', OPEN_FIELDS]),
    ]);
    return { slug, pulls: parsePulls(JSON.parse(all), JSON.parse(open)) };
  } catch (err) {
    return { slug, pulls: [], error: ghError(err) };
  }
}

/** Parses `gh issue list --json number,title,url,labels,assignees,author,createdAt,updatedAt`. */
export function parseIssues(data: unknown): Issue[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((i: Record<string, any>): Issue => ({
      number: i.number,
      title: i.title ?? '',
      url: i.url ?? '',
      labels: Array.isArray(i.labels) ? i.labels.map((l: { name?: string }) => l.name ?? '').filter(Boolean) : [],
      assignees: Array.isArray(i.assignees) ? i.assignees.map((a: { login?: string }) => a.login ?? '').filter(Boolean) : [],
      author: i.author?.login ?? null,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt ?? i.createdAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

const isSeverity = (v: unknown): v is Severity => (SEVERITIES as readonly unknown[]).includes(v);

/** Parses the REST list of Dependabot alerts (one page, or `--slurp`'s list of pages), most severe first. */
export function parseAlerts(data: unknown): Alert[] {
  if (!Array.isArray(data)) return [];
  return (data.every(Array.isArray) ? data.flat() : data)
    // Open only, and not withdrawn: GitHub withdrew the advisory, so it is no risk
    .filter((a: Record<string, any>) => (a.state === 'open' || a.state === undefined) && !a.security_advisory?.withdrawn_at)
    .map((a: Record<string, any>): Alert => {
      const sev = a.security_vulnerability?.severity ?? a.security_advisory?.severity;
      return {
        number: a.number,
        severity: isSeverity(sev) ? sev : 'low',
        package: a.dependency?.package?.name ?? a.security_vulnerability?.package?.name ?? 'unknown',
        ecosystem: a.dependency?.package?.ecosystem ?? '',
        summary: a.security_advisory?.summary ?? '',
        fixedIn: a.security_vulnerability?.first_patched_version?.identifier ?? null,
        url: a.html_url ?? '',
        createdAt: a.created_at,
      };
    })
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || b.createdAt.localeCompare(a.createdAt));
}

/** Open issues of one repo; an error instead when gh fails. */
export async function readIssues(slug: string, gh: GhRunner = ghRunner): Promise<Pick<RepoGithub, 'issues' | 'issuesError'>> {
  try {
    const out = await gh(['issue', 'list', '--repo', slug, '--state', 'open', '--limit', '100', '--json', 'number,title,url,labels,assignees,author,createdAt,updatedAt']);
    return { issues: parseIssues(JSON.parse(out)) };
  } catch (err) {
    return { issuesError: ghError(err) };
  }
}

/** Open Dependabot alerts of one repo; an error instead when they are off or not readable. */
export async function readAlerts(slug: string, gh: GhRunner = ghRunner): Promise<Pick<RepoGithub, 'alerts' | 'alertsError'>> {
  try {
    // Every page: a repo can have more than the 100 alerts of one page
    const out = await gh(['api', '--paginate', '--slurp', `repos/${slug}/dependabot/alerts?state=open&per_page=100`]);
    return { alerts: parseAlerts(JSON.parse(out)) };
  } catch (err) {
    return { alertsError: ghError(err) };
  }
}

/** Everything the dashboard reads from GitHub for one repo, the three reads in parallel. */
export async function readRepoGithub(slug: string, gh: GhRunner = ghRunner): Promise<RepoGithub> {
  const [pulls, issues, alerts] = await Promise.all([readPulls(slug, gh), readIssues(slug, gh), readAlerts(slug, gh)]);
  return { ...pulls, ...issues, ...alerts };
}

/** The signed-in GitHub user, for "assigned to you"; null when gh cannot say. */
export async function viewerLogin(gh: GhRunner = ghRunner): Promise<string | null> {
  try {
    return (await gh(['api', 'user', '--jq', '.login'])).trim() || null;
  } catch {
    return null;
  }
}

/** Runs `fn` over `items`, at most `limit` at a time, keeping their order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
