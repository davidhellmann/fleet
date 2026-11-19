/**
 * Starting the collector from the dashboard (background runs and the refresh button) and reading
 * its state. The collector runs as its own Node process, so a long run never blocks a page; its lock
 * keeps runs from overlapping.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lockHolder } from './lock.ts';

export interface CollectStatus {
  /** End of the last run; null before the first. */
  at: string | null;
  ok: boolean;
  error: string | null;
  /** A collector is running right now. */
  running: boolean;
}

export function collectStatus(fleetDir: string): CollectStatus {
  const running = lockHolder(join(fleetDir, '.cache', 'collect.lock')) !== null;
  const file = join(fleetDir, '.cache', 'last-collect.json');
  if (!existsSync(file)) return { at: null, ok: true, error: null, running };
  try {
    const d = JSON.parse(readFileSync(file, 'utf8'));
    return { at: d.at ?? null, ok: d.ok !== false, error: d.error ?? null, running };
  } catch {
    return { at: null, ok: true, error: null, running };
  }
}

/** Starts a collector in the background unless one runs; says which. */
export function startCollector(fleetDir: string): 'started' | 'running' {
  if (lockHolder(join(fleetDir, '.cache', 'collect.lock')) !== null) return 'running';
  const child = spawn(process.execPath, [join(fleetDir, 'dashboard', 'collect', 'index.ts')], { cwd: fleetDir, stdio: 'ignore', detached: true });
  child.unref();
  return 'started';
}
