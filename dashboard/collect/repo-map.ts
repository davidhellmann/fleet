/**
 * Maps a session's working directory to a repo of fleet.json. The layout differs between hosts
 * (flat or not) and agents work in checkouts fleet does not know (Delta and T3 worktrees), so the
 * Git remote decides first; the path second; then the name of a worktree folder, for worktrees
 * that are gone by now (`~/.t3/worktrees/<repo>/…`, `~/.herdr/worktrees/<repo>/…`); anything else
 * is `other`. fleet itself is `fleet`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoDir, worktreePath, type HostConfig, type Repo } from '../../scripts/config.ts';

export const OTHER = 'other';
export const FLEET = 'fleet';

/**
 * A remote in one comparable form: host/owner/name, lowercase, without scheme, user, `.git` or
 * trailing slash. `git@github.com:o/r.git` and `https://github.com/o/r` are the same.
 */
export function normalizeRemote(url: string): string {
  let s = url.trim().toLowerCase();
  s = s.replace(/^[a-z+]+:\/\//, '').replace(/^[^@/]+@/, '');
  s = s.replace(/^([^/:]+):(?!\d)/, '$1/');
  return s.replace(/\.git$/, '').replace(/\/+$/, '');
}

/** The `origin` remote of the checkout at `cwd`, or null (gone, not a repo, no origin). */
export function gitRemote(cwd: string): string | null {
  if (!cwd || !existsSync(cwd)) return null;
  try {
    return execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

const inside = (cwd: string, dir: string) => cwd === dir || cwd.startsWith(dir.endsWith('/') ? dir : `${dir}/`);

/**
 * A function from cwd to repo name, cached per cwd. `remoteOf` is injectable for tests.
 */
export function repoMatcher(
  repos: readonly Repo[],
  host: HostConfig,
  fleetDir: string,
  remoteOf: (cwd: string) => string | null = gitRemote,
): (cwd: string) => string {
  const byRemote = new Map<string, string>();
  for (const r of repos) {
    const remote = normalizeRemote(r.remote);
    byRemote.set(remote, r.name);
    // A renamed repo: the same owner, an earlier name
    const owner = remote.slice(0, remote.lastIndexOf('/') + 1);
    for (const former of r.formerNames ?? []) byRemote.set(normalizeRemote(`${owner}${former}`), r.name);
  }
  const fleetRemote = remoteOf(fleetDir);
  if (fleetRemote) byRemote.set(normalizeRemote(fleetRemote), FLEET);

  // Longest path first, so a repo inside another folder of the list wins
  const paths: [string, string][] = [[fleetDir.replace(/\/+$/, ''), FLEET]];
  for (const r of repos) {
    paths.push([repoDir(r, host), r.name]);
    for (const b of r.worktrees ?? []) paths.push([join(host.root, worktreePath(r, b, host)), r.name]);
    for (const former of r.formerNames ?? []) paths.push([repoDir({ ...r, name: former }, host), r.name]);
  }
  paths.sort((a, b) => b[0].length - a[0].length);

  // A repo name as a folder somewhere below a `worktrees` folder
  const names = new Map<string, string>([[FLEET, FLEET]]);
  for (const r of repos) for (const n of [r.name, ...(r.formerNames ?? [])]) names.set(n, r.name);
  const fromWorktreePath = (cwd: string): string | undefined => {
    const parts = cwd.split('/');
    const at = parts.lastIndexOf('worktrees');
    const folder = at < 0 ? undefined : parts.slice(at + 1).find((p) => names.has(p));
    return folder && names.get(folder);
  };

  const cache = new Map<string, string>();
  return (cwd: string) => {
    let name = cache.get(cwd);
    if (name !== undefined) return name;
    const remote = remoteOf(cwd);
    name = (remote && byRemote.get(normalizeRemote(remote))) || paths.find(([dir]) => inside(cwd, dir))?.[1] || fromWorktreePath(cwd) || OTHER;
    cache.set(cwd, name);
    return name;
  };
}
