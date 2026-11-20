import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Repo, parseRepos, renderRepoList } from './config.ts';
import { type Probe, compareStack, hostNeeds, stackFromRepo, versionsAgree } from './stack.ts';

let dir: string;
const put = (file: string, text = '') => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
};
const json = (value: unknown) => JSON.stringify(value);
const repo = (name: string, extra: Partial<Repo> = {}): Repo => ({ name, description: 'x.', remote: 'r', dir: '', ...extra });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stack-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('stack in fleet.json', () => {
  it('accepts tags with and without a version and lists them in REPOS.md', () => {
    const repos = parseRepos({ repos: [repo('site', { dir: 'Sites', stack: ['craft@5', 'php@8.4', 'composer', 'mysql@8.0'] })] });
    expect(renderRepoList(repos)).toContain('- **site**: x. Dir `Sites`; stack: craft@5, php@8.4, composer, mysql@8.0.');
  });

  it('rejects tags that are not `name` or `name@version`', () => {
    for (const stack of [[], ['PHP'], ['php 8.4'], ['php@^8.4'], ['craft-cms@']]) {
      expect(() => parseRepos({ repos: [repo('site', { stack })] }), JSON.stringify(stack)).toThrow(/"stack"/);
    }
  });
});

describe('versionsAgree', () => {
  it('compares the parts both versions name', () => {
    expect(versionsAgree('8.4', '8.4.27')).toBe(true);
    expect(versionsAgree('22', '22.18.0')).toBe(true);
    expect(versionsAgree('8.2', '8.4')).toBe(false);
  });
});

describe('stackFromRepo', () => {
  it('reads a Craft site: PHP from the platform pin, Craft, Composer, Node, pnpm and the services in .env.example', () => {
    put('composer.json', json({ require: { 'craftcms/cms': '^5.12.1' }, config: { platform: { php: '8.4.27' } } }));
    put('package.json', json({ packageManager: 'pnpm@10.28.2' }));
    put('.nvmrc', 'v22\n');
    put('.env.example', 'CRAFT_DB_DRIVER=mysql\nREDIS_HOSTNAME=\n');
    expect(stackFromRepo(dir).map((t) => (t.version ? `${t.name}@${t.version}` : t.name))).toEqual(['php@8.4', 'composer', 'node@22', 'pnpm', 'craft@5', 'mysql', 'redis']);
  });

  it('takes PHP from .valetrc without a platform pin, and skips version ranges', () => {
    put('composer.json', json({ require: { php: '>=8.2', 'craftcms/cms': '>=5.0' } }));
    put('.valetrc', 'php=php@8.4\n');
    expect(stackFromRepo(dir)).toEqual([
      { name: 'php', version: '8.4', from: '.valetrc' },
      { name: 'composer', from: 'composer.json' },
      { name: 'craft', from: 'composer.json' },
    ]);
  });

  it('leaves npm out, as it comes with Node, and finds Astro and Xcode projects', () => {
    put('package.json', json({ dependencies: { astro: '7.2.1' } }));
    put('package-lock.json', '{}');
    put('App.xcodeproj/project.pbxproj');
    expect(stackFromRepo(dir).map((t) => t.name)).toEqual(['node', 'astro', 'xcode']);
  });
});

describe('compareStack', () => {
  const found = [
    { name: 'php', version: '8.4', from: 'composer.json' },
    { name: 'composer', from: 'composer.json' },
  ];

  it('is ok when every tag the files show is there in an agreeing version', () => {
    expect(compareStack(['php@8.4', 'composer', 'mysql@8.0'], found)).toEqual({ mark: 'ok', note: 'php@8.4, composer, mysql@8.0' });
  });

  it('names the tags to add', () => {
    expect(compareStack(['php@8.4'], found)).toEqual({ mark: '--', note: 'add composer' });
    expect(compareStack(undefined, found)).toEqual({ mark: '--', note: 'add php@8.4, composer' });
  });

  it('flags a version that disagrees with the repo', () => {
    expect(compareStack(['php@8.2', 'composer'], found)).toEqual({ mark: '!!', note: 'php@8.2 but composer.json says 8.4' });
  });
});

describe('hostNeeds', () => {
  const host = (versions: Record<string, string>): Probe => (command) => versions[command] ?? null;
  const repos = [
    repo('site', { stack: ['craft@5', 'php@8.4', 'composer', 'mysql@8.0'] }),
    repo('kit', { stack: ['craft@5', 'php@8.2', 'composer'] }),
    repo('app', { stack: ['xcode'], os: ['macos'] }),
    repo('web', { stack: ['vite@8', 'xcode'] }),
  ];

  it('lists each host tool once per tag, with the repos that need it, leaving out frameworks, repos and tools of other systems', () => {
    const needs = hostNeeds(repos, 'linux', host({ php: '8.4.1', composer: 'Composer version 2.8.1', mysql: 'mysql  Ver 8.0.40' }));
    expect(needs.map((n) => [n.tag, n.cell.mark, n.repos.join(' ')])).toEqual([
      ['composer', 'ok', 'site kit'],
      ['mysql@8.0', 'ok', 'site'],
      ['php@8.2', '!!', 'kit'],
      ['php@8.4', 'ok', 'site'],
    ]);
  });

  it('finds a version installed beside the active one', () => {
    const needs = hostNeeds([repos[1]], 'macos', host({ php: '8.5.0', '/opt/homebrew/opt/php@8.2/bin/php': '8.2.30', composer: '2.8.1' }));
    expect(needs.find((n) => n.tag === 'php@8.2')?.cell).toEqual({ mark: 'ok', note: '8.2.30 (/opt/homebrew/opt/php@8.2/bin/php; active 8.5.0)' });
  });

  it('finds a Node version nvm installed', () => {
    const nvm = join(dir, 'nvm');
    mkdirSync(join(nvm, 'versions/node/v24.13.0/bin'), { recursive: true });
    process.env.NVM_DIR = nvm;
    try {
      const node24 = join(nvm, 'versions/node/v24.13.0/bin/node');
      const needs = hostNeeds([repo('site', { stack: ['node@24'] })], 'macos', host({ node: 'v22.22.3', [node24]: 'v24.13.0' }));
      expect(needs[0].cell).toEqual({ mark: 'ok', note: `24.13.0 (${node24}; active 22.22.3)` });
    } finally {
      delete process.env.NVM_DIR;
    }
  });

  it('marks a missing tool as broken, a service off PATH only as a hint', () => {
    const needs = hostNeeds([repos[0]], 'linux', host({}));
    expect(Object.fromEntries(needs.map((n) => [n.tag, n.cell.mark]))).toEqual({ composer: '!!', 'mysql@8.0': '--', 'php@8.4': '!!' });
  });
});
