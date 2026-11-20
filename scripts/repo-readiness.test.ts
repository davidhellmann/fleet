import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assessRepo, assessRepos, renderTable } from './repo-readiness.ts';
import type { Repo } from './config.ts';

let dir: string;
const put = (file: string, text = '') => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'readiness-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('assessRepo', () => {
  it('reports a bare repo as missing everything optional and not applicable to Node', () => {
    const r = assessRepo(dir);
    expect(r.readFirst.mark).toBe('--');
    expect(r.setup.mark).toBe('--');
    expect(r.dev.mark).toBe('n/a');
    expect(r.runtime.mark).toBe('n/a');
    expect(r.env.mark).toBe('--');
    expect(r.previews.mark).toBe('--');
    expect(r.stack).toEqual({ mark: '--', note: 'none' });
  });

  it('finds a ready Node repo', () => {
    put('AGENTS.md');
    put('.agents/setup', '#!/bin/sh\n');
    chmodSync(join(dir, '.agents/setup'), 0o755);
    put('package.json', JSON.stringify({ packageManager: 'pnpm@10.0.0', scripts: { dev: 'vite' } }));
    put('.node-version', '22');
    put('.env.example', 'API_KEY=\n');
    put('.env', 'API_KEY=secret\n');
    put('.amp/services.yaml');
    put('t3.json', '{}');
    const r = assessRepo(dir);
    expect(r.readFirst).toEqual({ mark: 'ok', note: 'AGENTS.md' });
    expect(r.setup).toEqual({ mark: 'ok', note: 'executable' });
    expect(r.dev.mark).toBe('ok');
    expect(r.runtime).toEqual({ mark: 'ok', note: 'pnpm, .node-version' });
    expect(r.env).toEqual({ mark: 'ok', note: '.env.example' });
    expect(r.previews).toEqual({ mark: 'ok', note: 'amp, t3' });
  });

  it('flags a setup script that is not executable', () => {
    put('.agents/setup', '#!/bin/sh\n');
    chmodSync(join(dir, '.agents/setup'), 0o644);
    expect(assessRepo(dir).setup.mark).toBe('!!');
  });

  it('flags a local .env without an example, as a fresh environment cannot know the names', () => {
    put('.env', 'TOKEN=x\n');
    expect(assessRepo(dir).env).toEqual({ mark: '!!', note: '.env here, names nowhere in Git' });
  });

  it('flags a declared read-first file that is missing', () => {
    put('AGENTS.md');
    expect(assessRepo(dir, 'CONTEXT.md').readFirst).toEqual({ mark: '!!', note: 'CONTEXT.md missing' });
  });

  it('takes the package manager from the lockfile and the Node pin from engines', () => {
    put('package.json', JSON.stringify({ engines: { node: '>=22' }, scripts: {} }));
    put('package-lock.json', '{}');
    const r = assessRepo(dir);
    expect(r.runtime).toEqual({ mark: 'ok', note: 'npm, engines' });
    expect(r.dev.mark).toBe('--');
  });

  it('names what the runtime lacks', () => {
    put('package.json', '{}');
    expect(assessRepo(dir).runtime).toEqual({ mark: '--', note: 'no Node version, no package manager' });
  });
});

describe('assessRepos', () => {
  const repo = (name: string, extra: Partial<Repo> = {}): Repo => ({ name, description: 'x.', remote: 'r', dir: '', ...extra });

  it('skips repos limited to another system and repos not cloned', () => {
    mkdirSync(join(dir, 'here'));
    const rows = assessRepos([repo('here'), repo('gone'), repo('mac', { os: ['macos'] })], (r) => join(dir, r.name), 'linux');
    expect(rows.map((r) => [r.name, r.readiness ? 'assessed' : r.skipped])).toEqual([
      ['here', 'assessed'],
      ['gone', 'not cloned; FLEET_CLONE=yes scripts/setup.sh'],
      ['mac', 'only on macos'],
    ]);
  });

  it('renders one line per repo with aligned columns', () => {
    mkdirSync(join(dir, 'here'));
    const table = renderTable(assessRepos([repo('here'), repo('mac', { os: ['macos'] })], (r) => join(dir, r.name), 'linux'));
    const [header, first, second] = table.split('\n');
    expect(header).toMatch(/^repo\s+read first\s+\.agents\/setup\s+dev\s+runtime\s+env names\s+previews\s+stack$/);
    expect(first).toMatch(/^here\s+-- none\s+-- none\s+n\/a\s+n\/a\s+-- none\s+-- none\s+-- none$/);
    expect(second).toBe('mac   -- only on macos');
    // The skipped row's long note does not widen the column under it.
    expect(header.indexOf('.agents/setup') - header.indexOf('read first')).toBe('read first'.length + 2);
  });
});
