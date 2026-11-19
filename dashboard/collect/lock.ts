/**
 * One collector at a time: the dashboard's background runs, its refresh button and a manual
 * `pnpm collect` share .cache/collect.lock (the running process's pid). A lock whose process is gone
 * is stale and taken over.
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Whether a process with `pid` is alive (EPERM: it exists but belongs to someone else). */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === 'EPERM';
  }
}

/** The pid holding the lock, when that process still runs; null otherwise. */
export function lockHolder(file: string, isAlive: (pid: number) => boolean = alive): number | null {
  try {
    const pid = Number(readFileSync(file, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 && isAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Takes the lock for this process; returns a release function, or null when another live collector
 * holds it.
 */
export function acquireLock(file: string, pid = process.pid, isAlive: (pid: number) => boolean = alive): (() => void) | null {
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(file, String(pid), { flag: 'wx' });
  } catch {
    if (lockHolder(file, isAlive) !== null) return null;
    // Stale: its process is gone
    writeFileSync(file, String(pid));
  }
  return () => {
    try {
      if (readFileSync(file, 'utf8').trim() === String(pid)) unlinkSync(file);
    } catch {}
  };
}
