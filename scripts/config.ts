/**
 * fleet's configuration, two JSON files:
 *
 * - fleet.json: the repos fleet manages. It lives in the private data repo, next to the usage data,
 *   so fleet itself holds nothing personal; without a data repo, in fleet (ignored by Git).
 * - fleet.local.json (ignored by Git, one per host, written by scripts/setup.sh): where the repos live
 *   on this host, what the host is called, and which private repo holds the data.
 *
 * Their shapes, loading with checks, where each file lives on a host (fleetPaths), repo paths and the
 * repo list for agents (REPOS.md). Runs on Node's type stripping (Node 22.18+), no build step.
 * scripts/setup.sh reads both files itself (Python), so a fresh host needs no Node to clone.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Os = 'macos' | 'linux';
export const OSES: readonly Os[] = ['macos', 'linux'];

/** One repo fleet manages (an entry of `repos` in fleet.json). */
export interface Repo {
  /** The repo name, unique; also its folder name. */
  name: string;
  /** What the repo is; a lowercase phrase ending in a full stop. */
  description: string;
  /** Git remote to clone from. */
  remote: string;
  /** Parent folder, relative to the host's root, e.g. "AI"; "" = the root itself. Ignored on a flat host. */
  dir: string;
  /** File to read before touching the repo. */
  readFirst?: string;
  /** Anything else to know. */
  note?: string;
  /** Public site the repo serves. */
  site?: string;
  /** Branches checked out as worktrees next to the repo, at `<name>-<branch>`. */
  worktrees?: string[];
  /**
   * Earlier names of the repo. A remote with this name at the same owner, or a folder of this name,
   * counts as this repo when the dashboard maps agent sessions (old checkouts, renamed repos).
   */
  formerNames?: string[];
  /**
   * Systems the repo is cloned on; missing = all. `macos` for repos that are only Swift/Xcode; a repo
   * with a part that runs elsewhere stays on all, with a note.
   */
  os?: Os[];
}

/** The settings of this host (fleet.local.json). */
export interface HostConfig {
  /** Absolute path of the folder that holds the repos. */
  root: string;
  /** Name of this host; tags its usage data (its folder in the data repo). Lowercase letters, digits, inner dashes. */
  host: string;
  /** true: ignore every repo's `dir` and keep all repos directly in `root`. */
  flat: boolean;
  /** true: this host reads the Amp account's usage (per account, so only one host should). */
  amp: boolean;
  /** Minutes between the dashboard's background collector runs while it is open; 0 = off. Default 15. */
  collectMinutes: number;
  /**
   * Git remote of the private data repo: fleet.json and the usage data. It lives at `<root>/<name>`,
   * its name taken from the remote. null: none, both stay in fleet.
   */
  data: string | null;
}

/** fleet's own folder, from this file's location (scripts/ is one below). */
export const FLEET_DIR = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

const FIELDS = new Set(['name', 'description', 'remote', 'dir', 'readFirst', 'note', 'site', 'worktrees', 'formerNames', 'os']);
const REQUIRED = ['name', 'description', 'remote'] as const;
const OPTIONAL_TEXT = ['readFirst', 'note', 'site'] as const;
export const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isTextList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(isText);
const fail = (file: string, problems: string[]) => {
  if (problems.length) throw new Error(`${file}:\n  ${problems.join('\n  ')}`);
};

/** Checks parsed fleet.json and returns its repos; throws one error listing every problem. */
export function parseRepos(data: unknown): Repo[] {
  const list = (data as { repos?: unknown } | null)?.repos;
  if (!Array.isArray(list)) throw new Error('fleet.json: expected { "repos": [ … ] }');

  const problems: string[] = [];
  const names = new Set<string>();

  list.forEach((entry: Record<string, unknown>, i) => {
    const at = isText(entry?.name) ? entry.name : `repos[${i}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      problems.push(`${at}: not an object`);
      return;
    }
    for (const key of Object.keys(entry)) if (!FIELDS.has(key)) problems.push(`${at}: unknown field "${key}"`);
    for (const key of REQUIRED) if (!isText(entry[key])) problems.push(`${at}: "${key}" is missing or empty`);
    for (const key of OPTIONAL_TEXT) if (key in entry && !isText(entry[key])) problems.push(`${at}: "${key}" must be a non-empty string`);

    if (typeof entry.dir !== 'string') problems.push(`${at}: "dir" is missing; use "" for the root itself`);
    else if (entry.dir.startsWith('/') || entry.dir.endsWith('/') || entry.dir.split('/').includes('..')) {
      problems.push(`${at}: "dir" must be relative to the root, without "..", leading or trailing slash`);
    }
    if (isText(entry.name) && (entry.name.includes('/') || entry.name.startsWith('.'))) {
      problems.push(`${at}: "name" is the folder name; no slash, no leading dot`);
    }
    if ('worktrees' in entry && !isTextList(entry.worktrees)) problems.push(`${at}: "worktrees" must be a non-empty list of branch names`);
    if ('formerNames' in entry && !(isTextList(entry.formerNames) && entry.formerNames.every((n) => !n.includes('/')))) {
      problems.push(`${at}: "formerNames" must be a non-empty list of names without slashes`);
    }
    if ('os' in entry && !(isTextList(entry.os) && entry.os.every((o) => (OSES as readonly string[]).includes(o)))) {
      problems.push(`${at}: "os" must be a non-empty list of ${OSES.join(', ')}`);
    }
    if (isText(entry.site) && !/^https?:\/\//.test(entry.site)) problems.push(`${at}: "site" must be an http(s) URL`);

    if (isText(entry.name)) {
      // Unique names keep a flat host free of clashes.
      if (names.has(entry.name)) problems.push(`${at}: name used twice`);
      names.add(entry.name);
    }
  });

  fail('fleet.json', problems);
  return list as Repo[];
}

/** Checks parsed fleet.local.json; throws one error listing every problem. */
export function parseHostConfig(data: unknown): HostConfig {
  const c = (data ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  if (!isText(c.root) || !c.root.startsWith('/')) problems.push('"root" must be an absolute path');
  if (typeof c.host !== 'string' || !HOST_NAME.test(c.host)) problems.push('"host" must use lowercase letters, digits and inner dashes');
  if ('flat' in c && typeof c.flat !== 'boolean') problems.push('"flat" must be true or false');
  if ('amp' in c && typeof c.amp !== 'boolean') problems.push('"amp" must be true or false');
  if ('collectMinutes' in c && !(typeof c.collectMinutes === 'number' && Number.isInteger(c.collectMinutes) && c.collectMinutes >= 0)) {
    problems.push('"collectMinutes" must be a whole number of minutes, 0 for off');
  }
  if ('data' in c && c.data !== null && !isText(c.data)) problems.push('"data" must be the Git remote of the data repo, or null');
  fail('fleet.local.json', problems);
  return { root: c.root as string, host: c.host as string, flat: c.flat === true, amp: c.amp === true, collectMinutes: typeof c.collectMinutes === 'number' ? c.collectMinutes : 15, data: isText(c.data) ? c.data.trim() : null };
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
export const loadRepos = (file: string): Repo[] => parseRepos(readJson(file));
export const loadHostConfig = (file: string): HostConfig => parseHostConfig(readJson(file));

/** A repo's name from its remote: the last path part without `.git` (`…/fleet-data.git` → `fleet-data`). */
export const repoNameOf = (remote: string): string => remote.replace(/\/+$/, '').split(/[/:]/).pop()!.replace(/\.git$/, '');

/** Where fleet finds its files on this host. */
export interface FleetPaths {
  /** fleet.local.json, this host's settings. */
  local: string;
  /** The private data repo; null without one. */
  data: string | null;
  /** fleet.json, the repo list: in the data repo, else in fleet. */
  list: string;
  /** The usage data, `<host>/` folders: the data repo, else stats/ in fleet. */
  usage: string;
  /** REPOS.md, the repo list for agents, generated in fleet. */
  repoList: string;
}

/** The paths for this host's settings (null before scripts/setup.sh has run). */
export function fleetPaths(fleetDir: string, host: HostConfig | null): FleetPaths {
  const data = host?.data ? join(host.root, repoNameOf(host.data)) : null;
  return {
    local: join(fleetDir, 'fleet.local.json'),
    data,
    list: join(data ?? fleetDir, 'fleet.json'),
    usage: data ?? join(fleetDir, 'stats'),
    repoList: join(fleetDir, 'REPOS.md'),
  };
}

/** This host's settings, or null before scripts/setup.sh has run here; an invalid file throws. */
export const readHostConfig = (fleetDir: string): HostConfig | null => {
  const file = join(fleetDir, 'fleet.local.json');
  return existsSync(file) ? loadHostConfig(file) : null;
};

/** Where the repo lives, relative to the root: `<dir>/<name>`, or `<name>` on a flat host. */
export const repoPath = (repo: Repo, { flat = false } = {}): string => (flat || !repo.dir ? repo.name : `${repo.dir}/${repo.name}`);

/** Absolute path of the repo on this host. */
export const repoDir = (repo: Repo, host: HostConfig): string => join(host.root, repoPath(repo, host));

/** Path of a worktree branch, relative to the root: next to the repo, `<name>-<branch>`. */
export const worktreePath = (repo: Repo, branch: string, opts: { flat?: boolean } = {}): string => `${repoPath(repo, opts)}-${branch}`;

const OS_LABEL: Record<Os, string> = { macos: 'macOS', linux: 'Linux' };

/** REPOS.md: one bullet per repo, in the order of fleet.json. Host-independent: dir and branches, no resolved paths. */
export function renderRepoList(repos: readonly Repo[]): string {
  const lines = repos.map((r) => {
    const facts = [
      r.dir && `dir \`${r.dir}\``,
      r.readFirst && `read first: \`${r.readFirst}\``,
      r.worktrees && `worktrees: ${r.worktrees.map((b) => `\`${b}\``).join(', ')}`,
      r.os && `only on ${r.os.map((o) => OS_LABEL[o]).join(', ')}`,
      r.formerNames && `formerly ${r.formerNames.map((n) => `\`${n}\``).join(', ')}`,
      r.site && `site: ${r.site}`,
      r.note && `note: ${r.note.replace(/\.$/, '')}`,
    ].filter(Boolean);
    const joined = facts.join('; ');
    const rest = joined ? ` ${joined[0].toUpperCase()}${joined.slice(1)}.` : '';
    return `- **${r.name}**: ${r.description}${rest}`;
  });
  return [
    '# Repos',
    '',
    'The repos fleet manages, generated from `fleet.json` by `scripts/write-repo-list.ts`; never edit by hand. Where they live and how to work in them: `AGENTS.md`.',
    '',
    ...lines,
    '',
  ].join('\n');
}

/** Writes REPOS.md when its text changed; with `check`, only tells. */
export function writeRepoList(file: string, repos: readonly Repo[], { check = false } = {}): 'unchanged' | 'written' | 'outdated' {
  const next = renderRepoList(repos);
  const now = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (now === next) return 'unchanged';
  if (check) return 'outdated';
  writeFileSync(file, next);
  return 'written';
}
