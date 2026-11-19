import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cannotSync, gitIn, pullData, pushData } from './sync.ts';
import { fleetPaths, parseHostConfig, repoNameOf, writeRepoList } from '../../scripts/config.ts';

/** A bare remote with one commit, and a clone of it per host. */
function setup(hosts: string[]) {
  const base = mkdtempSync(join(tmpdir(), 'fleet-sync-'));
  const remote = join(base, 'remote.git');
  const git = (dir: string, ...args: string[]) => {
    const r = gitIn(dir)(args);
    if (!r.ok) throw new Error(`git ${args.join(' ')}: ${r.out}`);
    return r.out;
  };
  mkdirSync(remote);
  git(remote, 'init', '-q', '--bare', '-b', 'master');
  const seed = join(base, 'seed');
  mkdirSync(seed);
  git(seed, 'init', '-q', '-b', 'master');
  git(seed, 'config', 'user.name', 'Test');
  git(seed, 'config', 'user.email', 'test@example.com');
  writeFileSync(join(seed, 'README.md'), 'data\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'first');
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', '-q', '-u', 'origin', 'master');
  const clones = Object.fromEntries(hosts.map((h) => {
    const dir = join(base, h);
    git(base, 'clone', '-q', remote, dir);
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'user.email', 'test@example.com');
    return [h, dir];
  }));
  const write = (host: string, file: string, text: string) => {
    mkdirSync(join(clones[host], host), { recursive: true });
    writeFileSync(join(clones[host], host, file), text);
  };
  return { base, clones, write, log: (dir: string) => git(dir, 'log', '--format=%s') };
}

describe('data repo sync', () => {
  it('lets two hosts push their own folders without conflicts, also when one pushed first', () => {
    const { clones, write, log } = setup(['mac', 'vps']);
    const mac = gitIn(clones.mac);
    const vps = gitIn(clones.vps);

    write('mac', '2026-11.json', 'mac 1');
    expect(pushData(mac, 'mac', '2026-11-19 08:00')).toBe('pushed 1 commit');

    // vps has not pulled: its push is refused, pulled and tried again
    write('vps', '2026-11.json', 'vps 1');
    expect(pushData(vps, 'vps', '2026-11-19 08:05')).toBe('pushed 1 commit');
    expect(existsSync(join(clones.vps, 'mac', '2026-11.json'))).toBe(true);

    expect(pullData(mac)).toBe('pulled');
    expect(existsSync(join(clones.mac, 'vps', '2026-11.json'))).toBe(true);
    expect(log(clones.mac).split('\n')).toEqual(['chore(vps): collect 2026-11-19 08:05', 'chore(mac): collect 2026-11-19 08:00', 'first']);
  });

  it('commits nothing when nothing changed, and only its own folder', () => {
    const { clones, write, log } = setup(['mac']);
    const mac = gitIn(clones.mac);
    expect(pushData(mac, 'mac', 'now')).toBe('nothing new');
    write('mac', 'a.json', 'x');
    writeFileSync(join(clones.mac, 'stray.txt'), 'not ours');
    expect(pushData(mac, 'mac', 'now')).toBe('pushed 1 commit');
    expect(gitIn(clones.mac)(['status', '--porcelain']).out).toBe('?? stray.txt');
    expect(log(clones.mac).split('\n')).toHaveLength(2);
  });

  it('pushes what an earlier run committed but could not push', () => {
    const { clones, write } = setup(['mac']);
    const mac = gitIn(clones.mac);
    write('mac', 'a.json', 'x');
    mac(['add', '-A']);
    mac(['commit', '-q', '-m', 'left over']);
    expect(pushData(mac, 'mac', 'now')).toBe('pushed 1 commit');
  });

  it('says why a folder cannot sync', () => {
    const { base, clones } = setup(['mac']);
    expect(cannotSync(gitIn(clones.mac))).toBeNull();
    expect(cannotSync(gitIn(base))).toBe('not a Git repo');
    mkdirSync(join(clones.mac, 'sub'));
    expect(cannotSync(gitIn(join(clones.mac, 'sub')))).toBe('inside another repo, not a clone of its own');
    gitIn(clones.mac)(['checkout', '-q', '-b', 'local']);
    expect(cannotSync(gitIn(clones.mac))).toBe('its branch has no upstream');
  });
});

describe('data repo config', () => {
  const host = { root: '/srv', host: 'vps', flat: true, amp: false, collectMinutes: 15 };
  it('puts list and usage data in the data repo, named after its remote, or in fleet without one', () => {
    const withData = parseHostConfig({ ...host, data: 'https://github.com/someone/fleet-data.git' });
    expect(withData.data).toBe('https://github.com/someone/fleet-data.git');
    expect(fleetPaths('/srv/fleet', withData)).toEqual({
      local: '/srv/fleet/fleet.local.json',
      data: '/srv/fleet-data',
      list: '/srv/fleet-data/fleet.json',
      usage: '/srv/fleet-data',
      repoList: '/srv/fleet/REPOS.md',
    });
    expect(fleetPaths('/srv/fleet', parseHostConfig({ ...host, data: null }))).toMatchObject({ data: null, list: '/srv/fleet/fleet.json', usage: '/srv/fleet/stats' });
    expect(fleetPaths('/srv/fleet', null)).toMatchObject({ data: null, list: '/srv/fleet/fleet.json' });
  });

  it('takes the repo name from any remote form, refuses an empty one', () => {
    expect(repoNameOf('git@github.com:someone/fleet-data.git')).toBe('fleet-data');
    expect(repoNameOf('https://github.com/someone/private-stuff/')).toBe('private-stuff');
    expect(() => parseHostConfig({ ...host, data: ' ' })).toThrow(/"data"/);
  });
});

describe('repo list for agents', () => {
  it('writes REPOS.md only when it changed, and --check only tells', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'fleet-list-')), 'REPOS.md');
    const repos = [{ name: 'site', description: 'a site.', remote: 'https://example.com/site', dir: 'web' }];
    expect(writeRepoList(file, repos, { check: true })).toBe('outdated');
    expect(writeRepoList(file, repos)).toBe('written');
    expect(writeRepoList(file, repos)).toBe('unchanged');
    expect(readFileSync(file, 'utf8')).toContain('- **site**: a site. Dir `web`.');
  });
});
