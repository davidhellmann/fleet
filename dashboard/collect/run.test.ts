import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireLock, lockHolder } from './lock.ts';
import { collectStatus } from './run.ts';
import { parseHostConfig } from '../../scripts/config.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'fleet-run-'));

describe('collector lock', () => {
  it('lets one collector in, refuses a second while the first lives, releases only its own', () => {
    const file = join(dir(), 'collect.lock');
    const living = new Set([111]);
    const isAlive = (pid: number) => living.has(pid);
    const release = acquireLock(file, 111, isAlive);
    expect(release).not.toBeNull();
    expect(acquireLock(file, 222, isAlive)).toBeNull();
    expect(lockHolder(file, isAlive)).toBe(111);
    release!();
    expect(existsSync(file)).toBe(false);
  });

  it('takes over a lock whose process is gone', () => {
    const file = join(dir(), 'collect.lock');
    writeFileSync(file, '999');
    const release = acquireLock(file, 333, () => false);
    expect(release).not.toBeNull();
    expect(readFileSync(file, 'utf8')).toBe('333');
  });
});

describe('collect status', () => {
  it('reads the last run and whether one runs now', () => {
    const fleet = dir();
    expect(collectStatus(fleet)).toEqual({ at: null, ok: true, error: null, running: false });
    mkdirSync(join(fleet, '.cache'));
    writeFileSync(join(fleet, '.cache', 'last-collect.json'), JSON.stringify({ at: '2026-11-19T00:00:00Z', ok: false, error: 'boom', report: [] }));
    writeFileSync(join(fleet, '.cache', 'collect.lock'), String(process.pid));
    expect(collectStatus(fleet)).toEqual({ at: '2026-11-19T00:00:00Z', ok: false, error: 'boom', running: true });
  });
});

describe('collectMinutes', () => {
  const base = { root: '/repos', host: 'studio' };
  it('defaults to 15, takes 0 for off, refuses anything else', () => {
    expect(parseHostConfig(base).collectMinutes).toBe(15);
    expect(parseHostConfig({ ...base, collectMinutes: 0 }).collectMinutes).toBe(0);
    expect(() => parseHostConfig({ ...base, collectMinutes: -5 })).toThrow(/collectMinutes/);
    expect(() => parseHostConfig({ ...base, collectMinutes: 2.5 })).toThrow(/collectMinutes/);
  });
});
