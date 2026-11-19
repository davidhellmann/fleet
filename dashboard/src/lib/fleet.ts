/**
 * fleet's configuration as the pages see it, read on the server on every request: the repos
 * (fleet.json) and this host (fleet.local.json), through the shared scripts/config.ts. fleet itself
 * is a project too: agents work in it, and the collector maps its sessions to `fleet`.
 */
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fleetPaths, loadRepos, readHostConfig, repoDir, repoPath, type HostConfig, type Os, type Repo } from '../../../scripts/config.ts';
import { gitStatus, type GitStatus } from '../../collect/git.ts';
import { FLEET, gitRemote } from '../../collect/repo-map.ts';

export type { GitStatus, HostConfig, Repo };


/** Where a repo stands on this host. */
export type RepoPresence = 'present' | 'missing' | 'other-os' | 'unknown';

export interface RepoOnHost extends Repo {
  /** Path relative to the root on this host (flat or not). */
  where: string;
  /** Absolute path on this host; null before setup. */
  path: string | null;
  presence: RepoPresence;
  /** fleet itself, not an entry of fleet.json. */
  self?: boolean;
}

export interface Project extends RepoOnHost {
  /** Live state of the checkout; null when it is not here or not a repo. */
  git: GitStatus | null;
}

const THIS_OS: Os | null = process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : null;

/** This host's settings, or null before scripts/setup.sh has run here; an invalid file throws. */
export const hostConfig = (): HostConfig | null => readHostConfig(__FLEET_DIR__);

function fleetItself(host: HostConfig | null): RepoOnHost {
  const where = host ? relative(host.root, __FLEET_DIR__) : 'fleet';
  return {
    path: __FLEET_DIR__,
    name: FLEET,
    description: 'this repo: the repo list, host setup, shared skills and this dashboard.',
    remote: gitRemote(__FLEET_DIR__) ?? '',
    dir: '',
    readFirst: 'AGENTS.md',
    where: where.startsWith('..') ? __FLEET_DIR__ : where,
    presence: 'present',
    self: true,
  };
}

/** Every repo of fleet.json, plus fleet itself, with its path and presence on this host. */
export function reposOnHost(host: HostConfig | null = hostConfig()): RepoOnHost[] {
  // The list lives in the data repo (else in fleet); none yet before setup
  const listFile = fleetPaths(__FLEET_DIR__, host).list;
  const repos: RepoOnHost[] = (existsSync(listFile) ? loadRepos(listFile) : []).map((repo) => {
    const where = repoPath(repo, { flat: host?.flat });
    const path = host ? repoDir(repo, host) : null;
    let presence: RepoPresence;
    if (repo.os && THIS_OS && !repo.os.includes(THIS_OS)) presence = 'other-os';
    else if (!path) presence = 'unknown';
    else presence = existsSync(path) ? 'present' : 'missing';
    return { ...repo, where, path, presence };
  });
  repos.push(fleetItself(host));
  return repos;
}

/** The repos with their live git state; the checkouts are read in parallel. */
export async function projects(host: HostConfig | null = hostConfig()): Promise<Project[]> {
  const repos = reposOnHost(host);
  const states = await Promise.all(repos.map((r) => (r.presence === 'present' && r.path ? gitStatus(r.path) : Promise.resolve(null))));
  return repos.map((r, i) => ({ ...r, git: states[i] }));
}

/** One project by name, with its git state; null when fleet does not know it. */
export async function project(name: string, host: HostConfig | null = hostConfig()): Promise<Project | null> {
  const repo = reposOnHost(host).find((r) => r.name === name);
  if (!repo) return null;
  return { ...repo, git: repo.presence === 'present' && repo.path ? await gitStatus(repo.path) : null };
}
